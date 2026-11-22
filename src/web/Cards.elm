module Cards exposing (sortByManaValue)

import Collate


{-| Cheapest first, like a mana curve; cards without a mana value (unrecognized) sort as zero, then
by name.
-}
sortByManaValue : ({ a | name : String } -> Maybe Float) -> List { a | name : String } -> List { a | name : String }
sortByManaValue manaValue =
    List.map (\r -> ( ( manaValue r |> Maybe.withDefault 0, Collate.key r.name ), r ))
        >> List.sortBy Tuple.first
        >> List.map Tuple.second
