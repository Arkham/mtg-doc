module CardRefs exposing (Part(..), parts)

{-| Card references in written copy, as shared/card-refs.ts marks them: every card a text names
is written [[Card Name]]; nothing else is ever treated as a card.
-}

import Regex exposing (Regex)


type Part
    = Words String
    | CardRef String


ref : Regex
ref =
    Regex.fromString "\\[\\[([^[\\]]+)\\]\\]" |> Maybe.withDefault Regex.never


{-| The text as parts: plain strings and the cards it references, in order.
-}
parts : String -> List Part
parts text =
    let
        step match ( acc, last ) =
            let
                name =
                    match.submatches |> List.head |> Maybe.andThen identity |> Maybe.withDefault ""

                before =
                    if match.index > last then
                        [ Words (String.slice last match.index text) ]

                    else
                        []
            in
            ( CardRef (String.trim name) :: List.reverse before ++ acc
            , match.index + String.length match.match
            )

        ( found, end ) =
            List.foldl step ( [], 0 ) (Regex.find ref text)

        rest =
            if end < String.length text then
                [ Words (String.dropLeft end text) ]

            else
                []
    in
    List.reverse found ++ rest
