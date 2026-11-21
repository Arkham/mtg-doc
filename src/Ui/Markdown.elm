module Ui.Markdown exposing (view)

{-| Minimal markdown for LLM research text: headings, lists, tables, bold/italic, links and card
references ([[Card Name]]).
-}

import Html exposing (Html, a, div, em, h4, li, p, strong, table, tbody, td, text, th, thead, tr, ul)
import Regex exposing (Regex)
import Ui.Attr exposing (class, href, rel, target)
import Ui.Card as Card


re : String -> Regex
re =
    Regex.fromString >> Maybe.withDefault Regex.never


inlineRe : Regex
inlineRe =
    re "(\\[\\[[^[\\]]+\\]\\])|\\*\\*([^*]+)\\*\\*|\\[([^\\]]+)\\]\\(([^)]+)\\)|\\*([^*]+)\\*"


{-| Inline markdown: card references, bold, italics and links.
-}
inline : Card.Ctx msg -> String -> List (Html msg)
inline ctx value =
    let
        step m ( acc, last ) =
            let
                before =
                    if m.index > last then
                        [ text (String.slice last m.index value) ]

                    else
                        []

                node =
                    case m.submatches of
                        (Just cardRef) :: _ ->
                            Card.prose ctx cardRef

                        _ :: (Just bold) :: _ ->
                            [ strong [] (inline ctx bold) ]

                        _ :: _ :: (Just label) :: (Just url) :: _ ->
                            [ a [ href url, target "_blank", rel "noreferrer" ] [ text label ] ]

                        _ :: _ :: _ :: _ :: (Just italic) :: _ ->
                            [ em [] (inline ctx italic) ]

                        _ ->
                            []
            in
            ( acc ++ before ++ node, m.index + String.length m.match )

        ( found, end ) =
            List.foldl step ( [], 0 ) (Regex.find inlineRe value)
    in
    if end < String.length value then
        found ++ [ text (String.dropLeft end value) ]

    else
        found


cells : String -> List String
cells row =
    row
        |> String.trim
        |> Regex.replace (re "^\\|") (always "")
        |> Regex.replace (re "\\|$") (always "")
        |> String.split "|"
        |> List.map String.trim


isTableSeparator : String -> Bool
isTableSeparator =
    Regex.contains (re "^\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?$")


tableView : Card.Ctx msg -> List String -> Html msg
tableView ctx rows =
    let
        parsed =
            List.map cells rows

        head =
            List.head parsed |> Maybe.withDefault []

        body =
            List.drop 2 parsed
    in
    div [ class "table-wrap" ]
        [ table [ class "data md-table" ]
            [ thead [] [ tr [] (List.map (\c -> th [] (inline ctx c)) head) ]
            , tbody []
                (List.map
                    (\r ->
                        tr []
                            (List.indexedMap
                                (\j _ -> td [] (inline ctx (List.drop j r |> List.head |> Maybe.withDefault "")))
                                head
                            )
                    )
                    body
                )
            ]
        ]


view : Card.Ctx msg -> String -> Html msg
view ctx value =
    let
        flushList s =
            if List.isEmpty s.list then
                s

            else
                { s | blocks = s.blocks ++ [ ul [] s.list ], list = [] }

        flushTable s =
            -- A header row followed by a |---| separator; anything else stays as plain lines.
            if List.length s.table >= 2 && isTableSeparator (List.drop 1 s.table |> List.head |> Maybe.withDefault "") then
                { s | blocks = s.blocks ++ [ tableView ctx s.table ], table = [] }

            else
                { s | blocks = s.blocks ++ List.map (\t -> p [] (inline ctx t)) s.table, table = [] }

        flush =
            flushList >> flushTable

        heading =
            re "^#{1,6}\\s+(.*)$"

        item =
            re "^(?:[-*]|\\d+\\.)\\s+(.*)$"

        firstGroup r t =
            Regex.find r t
                |> List.head
                |> Maybe.map (\m -> m.submatches |> List.head |> Maybe.andThen identity |> Maybe.withDefault "")

        step line s =
            let
                t =
                    String.trim line
            in
            if String.startsWith "|" t then
                let
                    flushed =
                        flushList s
                in
                { flushed | table = flushed.table ++ [ t ] }

            else
                let
                    s1 =
                        flushTable s
                in
                if t == "" || t == "---" then
                    flush s1

                else
                    case firstGroup heading t of
                        Just h ->
                            let
                                s2 =
                                    flush s1
                            in
                            { s2 | blocks = s2.blocks ++ [ h4 [] (inline ctx h) ] }

                        Nothing ->
                            case firstGroup item t of
                                Just i ->
                                    { s1 | list = s1.list ++ [ li [] (inline ctx i) ] }

                                Nothing ->
                                    let
                                        s2 =
                                            flush s1
                                    in
                                    { s2 | blocks = s2.blocks ++ [ p [] (inline ctx t) ] }

        final =
            Regex.split (re "\\r?\\n") value
                |> List.foldl step { blocks = [], list = [], table = [] }
                |> flush
    in
    div [ class "markdown" ] final.blocks
