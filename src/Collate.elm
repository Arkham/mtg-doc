module Collate exposing (key, sortBy)

{-| String order like JavaScript's `localeCompare` (Unicode's default collation), for sorting card
names: letters ignore case and accents first, punctuation and spaces sort before digits, and
digits before letters. Case and accents only break ties.
-}

import Dict exposing (Dict)


{-| Sorts by a name, computing each name's collation key once.
-}
sortBy : (a -> String) -> List a -> List a
sortBy name =
    List.map (\x -> ( key (name x), x )) >> List.sortBy Tuple.first >> List.map Tuple.second


{-| A string that sorts, as plain text, the way the names it was made from collate. Sorting by it
computes each name's weights once, not once per comparison.
-}
key : String -> String
key value =
    let
        -- Below every weight, so a name sorts before the longer names it starts.
        separator =
            String.fromChar (Char.fromCode 1)

        weight ( group, place ) =
            String.fromList [ Char.fromCode (0x0100 + group), Char.fromCode (0x0100 + place) ]
    in
    String.concat (List.map weight (primary value))
        ++ separator
        ++ String.fromList (List.map (\c -> Char.fromCode (0x0100 + c)) (secondary value))
        ++ separator
        ++ String.fromList (List.map (\c -> Char.fromCode (0x0100 + c)) (tertiary value))
        ++ separator
        ++ value


{-| Each character's weight: a group (space, punctuation, symbol, digit, letter), then its place
in the group.
-}
primary : String -> List ( Int, Int )
primary =
    String.toList >> List.concatMap weights


weights : Char -> List ( Int, Int )
weights c =
    let
        code =
            Char.toCode c
    in
    if code == 32 || code == 9 || code == 10 || code == 0xA0 then
        [ ( 0, 0 ) ]

    else
        case Dict.get code punctuation of
            Just rank ->
                [ ( 1, rank ) ]

            Nothing ->
                if code >= 48 && code <= 57 then
                    [ ( 3, code ) ]

                else
                    let
                        lower =
                            Char.toCode (Char.toLower c)
                    in
                    case Dict.get lower accents of
                        Just base ->
                            List.map (\l -> ( 4, l )) base

                        Nothing ->
                            if Char.isAlpha c || code >= 128 then
                                [ ( 4, lower ) ]

                            else
                                [ ( 2, code ) ]


{-| Punctuation in Unicode's default order, by character code. Dashes sort as the hyphen,
curly quotes as the apostrophe.
-}
punctuation : Dict Int Int
punctuation =
    let
        ranked =
            "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"
                |> String.toList
                |> List.indexedMap (\i ch -> ( Char.toCode ch, i ))

        rankOf ch =
            ranked |> List.filter (\( c, _ ) -> c == Char.toCode ch) |> List.head |> Maybe.map Tuple.second |> Maybe.withDefault 0
    in
    Dict.fromList
        (ranked
            ++ [ ( Char.toCode '’', rankOf '\'' )
               , ( Char.toCode '‘', rankOf '\'' )
               , ( Char.toCode '–', rankOf '-' )
               , ( Char.toCode '—', rankOf '-' )
               ]
        )


{-| Accents, in order, where the letters are the same.
-}
secondary : String -> List Int
secondary =
    String.toList
        >> List.map
            (\c ->
                let
                    lower =
                        Char.toCode (Char.toLower c)
                in
                if Dict.member lower accents then
                    lower

                else
                    0
            )


{-| Lowercase before uppercase, where everything else is the same.
-}
tertiary : String -> List Int
tertiary =
    String.toList
        >> List.map
            (\c ->
                if Char.isUpper c then
                    1

                else
                    0
            )


accents : Dict Int (List Int)
accents =
    [ ( "àáâãäåāăą", "a" )
    , ( "çćĉċč", "c" )
    , ( "ďđ", "d" )
    , ( "èéêëēĕėęě", "e" )
    , ( "ĝğġģ", "g" )
    , ( "ĥħ", "h" )
    , ( "ìíîïĩīĭįı", "i" )
    , ( "ĵ", "j" )
    , ( "ķ", "k" )
    , ( "ĺļľŀł", "l" )
    , ( "ñńņňŉ", "n" )
    , ( "òóôõöøōŏő", "o" )
    , ( "ŕŗř", "r" )
    , ( "śŝşš", "s" )
    , ( "ţťŧ", "t" )
    , ( "ùúûüũūŭůűų", "u" )
    , ( "ŵ", "w" )
    , ( "ýÿŷ", "y" )
    , ( "źżž", "z" )
    , ( "æ", "ae" )
    , ( "œ", "oe" )
    , ( "ß", "ss" )
    ]
        |> List.concatMap
            (\( letters, base ) ->
                List.map (\l -> ( Char.toCode l, List.map Char.toCode (String.toList base) )) (String.toList letters)
            )
        |> Dict.fromList
