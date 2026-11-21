module Combos exposing (MissingPiece, groupByMissing, outcome)

import List.Extra
import Regex exposing (Regex)
import Types exposing (Combo)


outcomes : List ( Regex, String )
outcomes =
    [ ( "each opponent loses the game|you win the game", "Wins the game" )
    , ( "(target|one) (opponent|player) loses the game", "Kills an opponent" )
    , ( "^infinite (damage|lifeloss|life loss)", "Infinite damage" )
    , ( "^near-infinite (damage|lifeloss|life loss)", "Near-infinite damage" )
    , ( "^lock$|can't (draw|cast|untap)", "Lock" )
    , ( "infinite .*mana", "Infinite mana" )
    , ( "^infinite card draw", "Infinite draw" )
    , ( "^near-infinite card draw(?! for)", "Near-infinite draw" )
    , ( "infinite .*(tokens|counters|turns)", "Infinite value" )
    ]
        |> List.map
            (\( pattern, label ) ->
                ( Regex.fromStringWith { caseInsensitive = True, multiline = False } pattern |> Maybe.withDefault Regex.never
                , label
                )
            )


{-| The one result that matters most, in plain words (Spellbook lists every side effect).
-}
outcome : List String -> String
outcome produces =
    case List.Extra.find (\( re, _ ) -> List.any (Regex.contains re) produces) outcomes of
        Just ( _, label ) ->
            label

        Nothing ->
            List.head produces |> Maybe.withDefault "Combo"


rank : String -> Int
rank label =
    List.Extra.findIndex (\( _, l ) -> l == label) outcomes |> Maybe.withDefault (List.length outcomes)


type alias MissingPiece =
    { name : String
    , combos : List { combo : Combo, partners : List String, outcome : String }

    -- Strongest outcome among its combos.
    , best : String
    }


{-| Groups "one card away" combos by the card you'd add, so a card that completes several combos
shows once. Cards completing more combos come first; ties keep Spellbook's popularity order.
-}
groupByMissing : List Combo -> List MissingPiece
groupByMissing combos =
    let
        step combo groups =
            case List.head combo.missing of
                Nothing ->
                    groups

                Just name ->
                    let
                        result =
                            outcome combo.produces

                        entry =
                            { combo = combo, partners = List.filter ((/=) name) combo.cards, outcome = result }
                    in
                    if List.any (\g -> g.name == name) groups then
                        List.map
                            (\g ->
                                if g.name == name then
                                    { g
                                        | combos = g.combos ++ [ entry ]
                                        , best =
                                            if rank result < rank g.best then
                                                result

                                            else
                                                g.best
                                    }

                                else
                                    g
                            )
                            groups

                    else
                        groups ++ [ { name = name, combos = [ entry ], best = result } ]
    in
    List.foldl step [] combos
        |> List.map (\g -> { g | combos = List.sortBy (.outcome >> rank) g.combos })
        |> List.indexedMap Tuple.pair
        |> List.sortWith
            (\( i, a ) ( j, b ) ->
                case compare (List.length b.combos) (List.length a.combos) of
                    EQ ->
                        compare i j

                    o ->
                        o
            )
        |> List.map Tuple.second
