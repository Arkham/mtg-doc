export default function postprocess(args: {
  code: string;
  compilationMode: "debug" | "standard" | "optimize";
}): Promise<string>;
