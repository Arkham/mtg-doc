/**
 * Generates the Elm side of the API from the TypeScript the server uses, so the two can't drift:
 * `src/web/Types.elm` (types, JSON decoders and encoders for everything in src/shared/types.ts) and
 * `src/web/Symbols.elm` (the bundled mana symbols in src/web/symbols.ts). `--check` fails if either is out
 * of date instead of writing it.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseSync } from "oxc-parser";

const ROOT = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

type T =
  | { k: "string" | "float" | "int" | "bool" }
  | { k: "list" | "dict"; of: T }
  | { k: "ref"; name: string };

interface Field {
  name: string;
  type: T;
  /** `?:`: the key may be missing. */
  optional: boolean;
  /** `| null`: the value may be null. */
  nullable: boolean;
  doc?: string;
}

/**
 * A discriminated union: object types told apart by a string field (`kind`, or another every
 * variant has), each with its own fields. It's an Elm custom type whose constructors carry those
 * fields, so a variant can't have another's. A variant that's an interface carries its record.
 */
interface Variant {
  value: string;
  fields: Field[];
  record?: string;
}

type Decl =
  | { kind: "record"; name: string; fields: Field[]; doc?: string }
  | { kind: "enum"; name: string; values: string[]; doc?: string }
  /** A union of number literals (`1 | 2 | 3`): an Elm custom type, read from and written as Ints. */
  | { kind: "numbers"; name: string; values: number[]; doc?: string }
  | { kind: "union"; name: string; tag: string; variants: Variant[]; doc?: string };

/** The usual field telling a discriminated union's variants apart. */
const TAG = "kind";

/** Interfaces that are variants of a union, and the field that tells them apart (not a field in Elm). */
const variantTags = new Map<string, string>();

// oxc's AST is plain JSON; only the handful of node types below appear in src/shared/types.ts.
// oxlint-disable-next-line typescript/no-explicit-any
type Node = any;

const source = fs.readFileSync(path.join(ROOT, "src/shared/types.ts"), "utf8");
const parsed = parseSync("types.ts", source);
if (parsed.errors.length) throw new Error(parsed.errors.map((e) => e.message).join("\n"));

const decls = new Map<string, Decl>();
const interfaces = new Map<string, Node>();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An Elm constructor's name: its type's, then the value in PascalCase. */
const ctor = (type: string, value: string) =>
  type +
  value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(cap)
    .join("");
const singular = (s: string) => (s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);

/** The JSDoc comment right before a node, as plain lines. */
function docBefore(node: Node): string | undefined {
  const before = source.slice(0, node.start).trimEnd();
  if (!before.endsWith("*/")) return undefined;
  const open = before.lastIndexOf("/**");
  if (open < 0) return undefined;
  const text = before
    .slice(open + 3, -2)
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, "").trim())
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

const numberLiterals = (types: Node[]) =>
  types.every((t) => t.type === "TSLiteralType" && typeof t.literal.value === "number")
    ? types.map((t) => t.literal.value as number)
    : null;

const stringLiterals = (types: Node[]) =>
  types.every((t) => t.type === "TSLiteralType" && typeof t.literal.value === "string")
    ? types.map((t) => t.literal.value as string)
    : null;

function register(decl: Decl) {
  const seen = decls.get(decl.name);
  if (seen && JSON.stringify(seen) !== JSON.stringify(decl))
    throw new Error(`Two different types would be called ${decl.name}`);
  decls.set(decl.name, decl);
}

/** A TypeScript type as an Elm one; `name` names any inline object or string union it holds. */
function convert(node: Node, name: string): { type: T; nullable: boolean } {
  switch (node.type) {
    case "TSStringKeyword":
      return { type: { k: "string" }, nullable: false };
    case "TSNumberKeyword":
      return { type: { k: "float" }, nullable: false };
    case "TSBooleanKeyword":
      return { type: { k: "bool" }, nullable: false };
    case "TSArrayType":
      return { type: { k: "list", of: plain(node.elementType, singular(name)) }, nullable: false };
    case "TSTypeReference": {
      const ref = node.typeName.name as string;
      // A whole number (`type Int = number` in the TypeScript).
      if (ref === "Int") return { type: { k: "int" }, nullable: false };
      if (ref === "Record")
        return {
          type: { k: "dict", of: plain(node.typeArguments.params[1], name) },
          nullable: false,
        };
      return { type: { k: "ref", name: ref }, nullable: false };
    }
    case "TSLiteralType":
      return convert({ type: "TSUnionType", types: [node] }, name);
    case "TSTypeLiteral":
      register({ kind: "record", name, fields: members(node.members, name) });
      return { type: { k: "ref", name }, nullable: false };
    case "TSUnionType": {
      const rest = node.types.filter((t: Node) => t.type !== "TSNullKeyword");
      const nullable = rest.length < node.types.length;
      const literals = stringLiterals(rest);
      if (literals) {
        register({ kind: "enum", name, values: literals });
        return { type: { k: "ref", name }, nullable };
      }
      const numbers = numberLiterals(rest);
      if (numbers) {
        register({ kind: "numbers", name, values: numbers });
        return { type: { k: "ref", name }, nullable };
      }
      if (rest.length > 1 && rest.every(isObject)) {
        const tag = tagOf(rest, name);
        register({
          kind: "union",
          name,
          tag,
          variants: rest.map((t: Node) => variant(t, name, tag)),
        });
        return { type: { k: "ref", name }, nullable };
      }
      if (rest.length !== 1) throw new Error(`Unsupported union in ${name}`);
      return { type: convert(rest[0], name).type, nullable };
    }
    default:
      throw new Error(`Unsupported type ${node.type} in ${name}`);
  }
}

const isObject = (t: Node) =>
  t.type === "TSTypeLiteral" ||
  (t.type === "TSTypeReference" && interfaces.has(t.typeName.name as string));

/** A union variant's members, inline or its interface's. */
const membersOf = (t: Node): Node[] =>
  t.type === "TSTypeLiteral" ? t.members : interfaces.get(t.typeName.name).body.body;

/** The value of a string literal member, if the variant has one by this name. */
function literalOf(t: Node, key: string): string | undefined {
  const m = membersOf(t).find((m: Node) => m.key?.name === key);
  return m && stringLiterals([m.typeAnnotation.typeAnnotation])?.[0];
}

/** The field that tells a union's variants apart: a string literal in every one, `kind` first. */
function tagOf(variants: Node[], union: string): string {
  const keys = membersOf(variants[0]).map((m: Node) => m.key?.name as string);
  const tag = [TAG, ...keys].find((k) => variants.every((t) => literalOf(t, k) !== undefined));
  if (!tag) throw new Error(`The variants of ${union} need a string literal field in common`);
  return tag;
}

/** One variant of a discriminated union: its tag's value, and the fields that come with it. */
function variant(node: Node, union: string, tag: string): Variant {
  const value = literalOf(node, tag)!;
  if (node.type === "TSTypeReference") {
    const record = node.typeName.name as string;
    interfaceDecl(interfaces.get(record));
    return { value, fields: fieldsOf(record), record };
  }
  const rest = node.members.filter((m: Node) => m.key?.name !== tag);
  return { value, fields: members(rest, union + ctor("", value)) };
}

function plain(node: Node, name: string): T {
  const { type, nullable } = convert(node, name);
  if (nullable) throw new Error(`Nullable element in ${name}`);
  return type;
}

function members(list: Node[], parent: string): Field[] {
  return list.map((m) => {
    if (m.type !== "TSPropertySignature") throw new Error(`Unsupported member in ${parent}`);
    const key = m.key.name as string;
    const { type, nullable } = convert(m.typeAnnotation.typeAnnotation, parent + cap(key));
    return { name: key, type, optional: m.optional, nullable, doc: docBefore(m) };
  });
}

function fieldsOf(name: string): Field[] {
  const decl = decls.get(name);
  if (decl?.kind === "record") return decl.fields;
  throw new Error(`${name} isn't an object type`);
}

for (const statement of parsed.program.body as Node[]) {
  const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (node?.type === "TSInterfaceDeclaration") interfaces.set(node.id.name, node);
}
for (const statement of parsed.program.body as Node[]) {
  const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  const t = node?.type === "TSTypeAliasDeclaration" ? node.typeAnnotation : null;
  if (t?.type !== "TSUnionType" || !t.types.every((v: Node) => v.type === "TSTypeReference"))
    continue;
  if (!t.types.every(isObject)) continue;
  const tag = tagOf(t.types, node.id.name);
  for (const v of t.types) variantTags.set(v.typeName.name, tag);
}

function interfaceDecl(node: Node) {
  const name = node.id.name as string;
  if (decls.has(name)) return;
  const inherited = (node.extends ?? []).flatMap((h: Node) => {
    const base = h.expression.name as string;
    interfaceDecl(interfaces.get(base));
    return fieldsOf(base);
  });
  register({
    kind: "record",
    name,
    fields: [
      ...inherited,
      ...members(
        node.body.body.filter((m: Node) => m.key?.name !== variantTags.get(name)),
        name,
      ),
    ],
    doc: docBefore(node),
  });
}

for (const statement of parsed.program.body as Node[]) {
  const node = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  if (!node) continue;
  if (node.type === "TSInterfaceDeclaration") interfaceDecl(node);
  else if (node.type === "TSTypeAliasDeclaration") {
    const name = node.id.name as string;
    // Marks whole numbers; fields of this type are Elm Ints (see `convert`).
    if (name === "Int") continue;
    const t: Node = node.typeAnnotation;
    if (t.type === "TSTypeReference" && t.typeName.name === "Partial") {
      // Partial<Pick<Base, "a" | "b">>
      const pick = t.typeArguments.params[0];
      const base = pick.typeArguments.params[0].typeName.name as string;
      const keys = stringLiterals(
        pick.typeArguments.params[1].types ?? [pick.typeArguments.params[1]],
      )!;
      interfaceDecl(interfaces.get(base));
      const fields = fieldsOf(base)
        .filter((f) => keys.includes(f.name))
        .map((f) => ({ ...f, optional: true }));
      register({ kind: "record", name, fields, doc: docBefore(node) });
    } else {
      const { type, nullable } = convert(t, name);
      if (nullable || type.k !== "ref" || type.name !== name)
        throw new Error(`Unsupported type alias ${name}`);
      const decl = decls.get(name)!;
      decl.doc = docBefore(node);
    }
  }
}

// Elm keywords can't be record fields.
const KEYWORDS = new Set(["in", "type", "of", "let", "case", "if", "then", "else", "as", "port"]);
const elmField = (name: string) => (KEYWORDS.has(name) ? `${name}_` : name);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function elmType(t: T): string {
  switch (t.k) {
    case "string":
      return "String";
    case "float":
      return "Float";
    case "int":
      return "Int";
    case "bool":
      return "Bool";
    case "list":
      return `List ${wrap(elmType(t.of))}`;
    case "dict":
      return `Dict String ${wrap(elmType(t.of))}`;
    case "ref":
      return t.name;
  }
}
const wrap = (s: string) => (s.includes(" ") ? `(${s})` : s);

/**
 * What an absent optional list or flag means: none, or false. Elm gets the value itself rather
 * than a `Maybe` every view would have to unwrap the same way.
 */
function absentAs(f: Field): string | null {
  if (!f.optional || f.nullable) return null;
  if (f.type.k === "list") return "[]";
  if (f.type.k === "bool") return "False";
  return null;
}

const fieldType = (f: Field) =>
  (f.optional || f.nullable) && !absentAs(f) ? `Maybe ${wrap(elmType(f.type))}` : elmType(f.type);

function decoder(t: T): string {
  switch (t.k) {
    case "string":
      return "D.string";
    case "float":
      return "D.float";
    case "int":
      return "D.int";
    case "bool":
      return "D.bool";
    case "list":
      return `(D.list ${decoder(t.of)})`;
    case "dict":
      return `(D.dict ${decoder(t.of)})`;
    case "ref":
      return `${lower(t.name)}Decoder`;
  }
}

function encoder(t: T): string {
  switch (t.k) {
    case "string":
      return "E.string";
    case "float":
      return "E.float";
    case "int":
      return "E.int";
    case "bool":
      return "E.bool";
    case "list":
      return `(E.list ${encoder(t.of)})`;
    case "dict":
      return `(E.dict identity ${encoder(t.of)})`;
    case "ref":
      return `encode${t.name}`;
  }
}

const comment = (doc: string | undefined) => (doc ? `{-| ${doc}\n-}\n` : "");

/** Pipeline steps decoding a record's fields, in order. */
const decodeSteps = (fields: Field[], indent: string) =>
  fields.map((f) => {
    const d = decoder(f.type);
    const absent = absentAs(f);
    if (absent) return `${indent}|> P.optional ${JSON.stringify(f.name)} ${d} ${absent}`;
    if (f.optional)
      return `${indent}|> P.optional ${JSON.stringify(f.name)} (D.map Just ${d}) Nothing`;
    if (f.nullable) return `${indent}|> P.required ${JSON.stringify(f.name)} (D.nullable ${d})`;
    return `${indent}|> P.required ${JSON.stringify(f.name)} ${d}`;
  });

/** Key-value pairs encoding a record's fields (`Maybe`s: an absent optional field has none). */
const encodePairs = (fields: Field[], value: string) =>
  fields.map((f) => {
    const key = JSON.stringify(f.name);
    const get = `${value}.${elmField(f.name)}`;
    const e = encoder(f.type);
    if (absentAs(f)) return `Just ( ${key}, ${e} ${get} )`;
    if (f.optional) return `Maybe.map (\\v -> ( ${key}, ${e} v )) ${get}`;
    if (f.nullable) return `Just ( ${key}, Maybe.withDefault E.null (Maybe.map ${e} ${get}) )`;
    return `Just ( ${key}, ${e} ${get} )`;
  });

const recordType = (fields: Field[]) =>
  `{ ${fields.map((f) => `${elmField(f.name)} : ${fieldType(f)}`).join(", ")} }`;

function emitUnion(decl: Extract<Decl, { kind: "union" }>): string {
  const fn = lower(decl.name);
  const cases = decl.variants.map((v) => ({ ...v, ctor: ctor(decl.name, v.value) }));
  const type = `${comment(decl.doc)}type ${decl.name}\n    = ${cases
    .map((c) =>
      c.record
        ? `${c.ctor} ${c.record}`
        : c.fields.length
          ? `${c.ctor} ${recordType(c.fields)}`
          : c.ctor,
    )
    .join("\n    | ")}`;
  const branches = cases.map((c) => {
    if (c.record)
      return `                    ${JSON.stringify(c.value)} ->\n                        D.map ${c.ctor} ${lower(c.record)}Decoder`;
    if (!c.fields.length)
      return `                    ${JSON.stringify(c.value)} ->\n                        D.succeed ${c.ctor}`;
    const names = c.fields.map((_, i) => `v${i}`);
    const build = `(\\${names.join(" ")} -> ${c.ctor} { ${c.fields
      .map((f, i) => `${elmField(f.name)} = ${names[i]}`)
      .join(", ")} })`;
    return `                    ${JSON.stringify(c.value)} ->\n                        D.succeed ${build}\n${decodeSteps(c.fields, "                            ").join("\n")}`;
  });
  const dec = `${fn}Decoder : Decoder ${decl.name}\n${fn}Decoder =\n    D.field ${JSON.stringify(decl.tag)} D.string\n        |> D.andThen\n            (\\tag ->\n                case tag of\n${branches.join("\n\n")}\n\n                    _ ->\n                        D.fail ("Unknown ${decl.name}: " ++ tag)\n            )`;
  const encCases = cases.map((c) => {
    const kind = `( ${JSON.stringify(decl.tag)}, E.string ${JSON.stringify(c.value)} )`;
    if (!c.fields.length) return `        ${c.ctor} ->\n            E.object [ ${kind} ]`;
    return `        ${c.ctor} fields ->\n            E.object\n                (${kind}\n                    :: List.filterMap identity\n                        [ ${encodePairs(c.fields, "fields").join("\n                        , ")}\n                        ]\n                )`;
  });
  const enc = `encode${decl.name} : ${decl.name} -> E.Value\nencode${decl.name} value =\n    case value of\n${encCases.join("\n\n")}`;
  return [type, dec, enc].join("\n\n\n");
}

/** Every value of an enum, in order: a list that can't leave one out. */
const allValues = (name: string, ctors: readonly string[]) =>
  `{-| Every ${name}, in order.\n-}\n${lower(name)}Values : List ${name}\n${lower(name)}Values =\n    [ ${ctors.join(", ")} ]`;

function emitNumbers(decl: Extract<Decl, { kind: "numbers" }>): string {
  const fn = lower(decl.name);
  const cases = decl.values.map((v) => [ctor(decl.name, String(v)), v] as const);
  return [
    `${comment(decl.doc)}type ${decl.name}\n    = ${cases.map(([c]) => c).join("\n    | ")}`,
    `${fn}ToInt : ${decl.name} -> Int\n${fn}ToInt value =\n    case value of\n${cases
      .map(([c, v]) => `        ${c} ->\n            ${v}`)
      .join("\n\n")}`,
    `${fn}FromInt : Int -> Maybe ${decl.name}\n${fn}FromInt value =\n    case value of\n${cases
      .map(([c, v]) => `        ${v} ->\n            Just ${c}`)
      .join("\n\n")}\n\n        _ ->\n            Nothing`,
    `${fn}Decoder : Decoder ${decl.name}\n${fn}Decoder =\n    D.int\n        |> D.andThen\n            (\\value ->\n                case ${fn}FromInt value of\n                    Just v ->\n                        D.succeed v\n\n                    Nothing ->\n                        D.fail ("Unknown ${decl.name}: " ++ String.fromInt value)\n            )`,
    `encode${decl.name} : ${decl.name} -> E.Value\nencode${decl.name} =\n    ${fn}ToInt >> E.int`,
    allValues(
      decl.name,
      cases.map(([c]) => c),
    ),
  ].join("\n\n\n");
}

function emit(decl: Decl): string {
  if (decl.kind === "union") return emitUnion(decl);
  if (decl.kind === "numbers") return emitNumbers(decl);
  const fn = lower(decl.name);
  if (decl.kind === "enum") {
    const cases = decl.values.map((v) => [ctor(decl.name, v), v] as const);
    return [
      `${comment(decl.doc)}type ${decl.name}\n    = ${cases.map(([c]) => c).join("\n    | ")}`,
      `${fn}ToString : ${decl.name} -> String\n${fn}ToString value =\n    case value of\n${cases
        .map(([c, v]) => `        ${c} ->\n            ${JSON.stringify(v)}`)
        .join("\n\n")}`,
      `${fn}FromString : String -> Maybe ${decl.name}\n${fn}FromString value =\n    case value of\n${cases
        .map(([c, v]) => `        ${JSON.stringify(v)} ->\n            Just ${c}`)
        .join("\n\n")}\n\n        _ ->\n            Nothing`,
      `${fn}Decoder : Decoder ${decl.name}\n${fn}Decoder =\n    D.string\n        |> D.andThen\n            (\\value ->\n                case ${fn}FromString value of\n                    Just v ->\n                        D.succeed v\n\n                    Nothing ->\n                        D.fail ("Unknown ${decl.name}: " ++ value)\n            )`,
      `encode${decl.name} : ${decl.name} -> E.Value\nencode${decl.name} =\n    ${fn}ToString >> E.string`,
      allValues(
        decl.name,
        cases.map(([c]) => c),
      ),
    ].join("\n\n\n");
  }
  const fields = decl.fields;
  const docs = fields.filter((f) => f.doc).map((f) => `${elmField(f.name)}: ${f.doc}`);
  const doc = [decl.doc, ...docs].filter(Boolean).join("\n\n");
  const alias = `${doc ? `{-| ${doc}\n-}\n` : ""}type alias ${decl.name} =\n    { ${fields
    .map((f) => `${elmField(f.name)} : ${fieldType(f)}`)
    .join("\n    , ")}\n    }`;
  const dec = `${fn}Decoder : Decoder ${decl.name}\n${fn}Decoder =\n    D.succeed ${decl.name}\n${decodeSteps(fields, "        ").join("\n")}`;
  const pairs = encodePairs(fields, "value");
  const enc = `encode${decl.name} : ${decl.name} -> E.Value\nencode${decl.name} value =\n    E.object\n        (List.filterMap identity\n            [ ${pairs.join("\n            , ")}\n            ]\n        )`;
  return [alias, dec, enc].join("\n\n\n");
}

const ordered = [...decls.values()].sort((a, b) => a.name.localeCompare(b.name));
const exposing = ordered.flatMap((d) =>
  d.kind === "union"
    ? [`${d.name}(..)`, `${lower(d.name)}Decoder`, `encode${d.name}`]
    : d.kind === "numbers"
      ? [
          `${d.name}(..)`,
          `${lower(d.name)}ToInt`,
          `${lower(d.name)}FromInt`,
          `${lower(d.name)}Values`,
          `${lower(d.name)}Decoder`,
          `encode${d.name}`,
        ]
      : d.kind === "enum"
        ? [
            `${d.name}(..)`,
            `${lower(d.name)}ToString`,
            `${lower(d.name)}FromString`,
            `${lower(d.name)}Values`,
            `${lower(d.name)}Decoder`,
            `encode${d.name}`,
          ]
        : [d.name, `${lower(d.name)}Decoder`, `encode${d.name}`],
);

const types = `module Types exposing
    ( ${exposing.join("\n    , ")}
    )

{-| Generated by scripts/gen-elm.ts from src/shared/types.ts. Do not edit by hand.
-}

import Dict exposing (Dict)
import Json.Decode as D exposing (Decoder)
import Json.Decode.Pipeline as P
import Json.Encode as E


${ordered.map(emit).join("\n\n\n")}
`;

// The bundled mana symbols: symbol text (without braces) → file name in public/symbols.
const symbolsSource = fs.readFileSync(path.join(ROOT, "src/web/symbols.ts"), "utf8");
const symbolsStatement: Node = parseSync("symbols.ts", symbolsSource).program.body[0];
const symbolsAst = symbolsStatement.declaration.declarations[0].init;
const symbolPairs = (symbolsAst.properties as Node[]).map(
  (p) => [p.key.value ?? p.key.name, p.value.value] as [string, string],
);
const symbols = `module Symbols exposing (file)

{-| Generated by scripts/gen-elm.ts from src/web/symbols.ts. Do not edit by hand.
-}

import Dict exposing (Dict)


{-| Symbol text (without braces) → file name in public/symbols.
-}
file : String -> Maybe String
file symbol =
    Dict.get symbol files


files : Dict String String
files =
    Dict.fromList
        [ ${symbolPairs.map(([k, v]) => `( ${JSON.stringify(k)}, ${JSON.stringify(v)} )`).join("\n        , ")}
        ]
`;

let stale = false;
for (const [file, text] of [
  ["src/web/Types.elm", types],
  ["src/web/Symbols.elm", symbols],
] as const) {
  const target = path.join(ROOT, file);
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  const formatted = await elmFormat(text);
  if (current === formatted) continue;
  if (values.check) {
    console.error(`${file} is out of date: run pnpm gen:elm`);
    stale = true;
  } else {
    fs.writeFileSync(target, formatted);
    console.log(`Wrote ${file}`);
  }
}
if (stale) process.exit(1);

async function elmFormat(text: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync(path.join(ROOT, "node_modules/.bin/elm-format"), ["--stdin"], {
    input: text,
    encoding: "utf8",
  });
}
