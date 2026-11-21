module Cards exposing (sortByManaValue)

import Collate


{-| Cheapest first, like a mana curve; cards without data (unrecognized) sort as zero, then by name.
-}
sortByManaValue : List { a | name : String, card : Maybe { b | cmc : Float } } -> List { a | name : String, card : Maybe { b | cmc : Float } }
sortByManaValue =
    List.map (\r -> ( ( r.card |> Maybe.map .cmc |> Maybe.withDefault 0, Collate.key r.name ), r ))
        >> List.sortBy Tuple.first
        >> List.map Tuple.second
