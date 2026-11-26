module Cards exposing (sortByManaValue)

import Collate
import Ui.Mana as Mana


{-| What a card's mana value sorts by: its mana value, and whether its cost has an X in it.
-}
type alias Mana =
    { cmc : Float
    , manaCost : String
    }


{-| Cheapest first, like a mana curve; cards with X in their mana cost last, since their mana value
counts the X as zero. At the same mana value, the one that asks for fewer colored symbols comes
first. Cards without a mana value (unrecognized) sort as zero, then by name.
-}
sortByManaValue : ({ a | name : String } -> Maybe Mana) -> List { a | name : String } -> List { a | name : String }
sortByManaValue manaValue =
    List.map
        (\r ->
            case manaValue r of
                Just m ->
                    ( ( if Mana.hasX m.manaCost then
                            1

                        else
                            0
                      , m.cmc
                      , ( Mana.coloredSymbols m.manaCost, Collate.key r.name )
                      )
                    , r
                    )

                Nothing ->
                    ( ( 0, 0, ( 0, Collate.key r.name ) ), r )
        )
        >> List.sortBy Tuple.first
        >> List.map Tuple.second
