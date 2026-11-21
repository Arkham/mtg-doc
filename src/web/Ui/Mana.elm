module Ui.Mana exposing (colorIdentity, cost, oracleText, symbolUrl)

import Html exposing (Html, div, em, img, p, span, text)
import Html.Attributes exposing (attribute, height, width)
import Regex exposing (Regex)
import Symbols
import Types exposing (Color, colorToString)
import Ui.Attr exposing (alt, class, src)


{-| URL for a symbol like "G", "2/W" or "T": bundled with the app, Scryfall for any unknown one.
-}
symbolUrl : String -> String -> String
symbolUrl base sym =
    case Symbols.file sym of
        Just file ->
            base ++ "symbols/" ++ file ++ ".svg"

        Nothing ->
            "https://svgs.scryfall.io/card-symbols/" ++ String.replace "/" "" sym ++ ".svg"


symbolRe : Regex
symbolRe =
    Regex.fromString "\\{([^}]+)\\}" |> Maybe.withDefault Regex.never


{-| A mana cost like "{2}{G}{B/P}" in Scryfall's symbols.
-}
cost : String -> Int -> Maybe String -> Html msg
cost base size manaCost =
    case manaCost of
        Nothing ->
            text ""

        Just "" ->
            text ""

        Just value ->
            span [ class "mana-cost", attribute "aria-label" value ]
                (String.split " // " value
                    |> List.indexedMap
                        (\i face ->
                            span [ class "mana-face" ]
                                ((if i > 0 then
                                    [ span [ class "muted" ] [ text " // " ] ]

                                  else
                                    []
                                 )
                                    ++ List.map
                                        (\m ->
                                            let
                                                sym =
                                                    m.submatches |> List.head |> Maybe.andThen identity |> Maybe.withDefault ""
                                            in
                                            img
                                                [ src (symbolUrl base sym)
                                                , alt ("{" ++ sym ++ "}")
                                                , width size
                                                , height size
                                                ]
                                                []
                                        )
                                        (Regex.find symbolRe face)
                                )
                        )
                )


colorIdentity : String -> Int -> Maybe (List Color) -> Html msg
colorIdentity base size colors =
    case colors of
        Nothing ->
            text ""

        Just [] ->
            cost base size (Just "{C}")

        Just list ->
            cost base size (Just (String.concat (List.map (\c -> "{" ++ colorToString c ++ "}") list)))


splitKeeping : Regex -> String -> List String
splitKeeping re value =
    -- String.split with a capturing group, as JavaScript does: the separators stay in the list.
    let
        step m ( acc, last ) =
            ( m.match :: String.slice last m.index value :: acc, m.index + String.length m.match )

        ( parts, end ) =
            List.foldl step ( [], 0 ) (Regex.find re value)
    in
    List.reverse (String.dropLeft end value :: parts)


symbolPartRe : Regex
symbolPartRe =
    Regex.fromString "\\{[^}]+\\}" |> Maybe.withDefault Regex.never


reminderRe : Regex
reminderRe =
    Regex.fromString "\\([^)]*\\)" |> Maybe.withDefault Regex.never


symbols : String -> Int -> String -> List (Html msg)
symbols base size value =
    splitKeeping symbolPartRe value
        |> List.map
            (\part ->
                if String.startsWith "{" part && String.endsWith "}" part && String.length part > 2 then
                    img
                        [ class "oracle-symbol"
                        , src (symbolUrl base (String.slice 1 -1 part))
                        , alt part
                        , width size
                        , height size
                        ]
                        []

                else
                    text part
            )


{-| Rules text with mana symbols and muted reminder text, one paragraph per ability.
-}
oracleText : String -> Int -> String -> Html msg
oracleText base size value =
    div [ class "oracle" ]
        (String.split "\n//\n" value
            |> List.map
                (\face ->
                    div [ class "oracle-face" ]
                        (String.split "\n" face
                            |> List.map
                                (\line ->
                                    p []
                                        (splitKeeping reminderRe line
                                            |> List.map
                                                (\chunk ->
                                                    if String.startsWith "(" chunk then
                                                        em [ class "reminder" ] (symbols base size chunk)

                                                    else
                                                        span [] (symbols base size chunk)
                                                )
                                        )
                                )
                        )
                )
        )
