module Cards exposing (isBasicLand, sortByManaValue)

import Collate
import Ui.Mana as Mana


{-| Basic lands, including the snow-covered ones: they go after the other lands, since they fill
out a mana base rather than shape it.
-}
isBasicLand : String -> Bool
isBasicLand name =
    List.member name [ "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes" ]
        || String.startsWith "Snow-Covered " name


{-| What a card's mana value sorts by: its mana value, and whether its cost has an X in it.
-}
type alias Mana =
    { cmc : Float
    , manaCost : String
    }


{-| Cheapest first, like a mana curve; cards with X in their mana cost last, since their mana value
counts the X as zero. Basic lands go after the other lands. At the same mana value, the one that
asks for fewer colored symbols comes first. Cards without a mana value (unrecognized) sort as zero,
then by name.
-}
sortByManaValue : ({ a | name : String } -> Maybe Mana) -> List { a | name : String } -> List { a | name : String }
sortByManaValue manaValue =
    List.map
        (\r ->
            let
                basic =
                    if isBasicLand r.name then
                        1

                    else
                        0
            in
            case manaValue r of
                Just m ->
                    ( ( ( basic
                        , if Mana.hasX m.manaCost then
                            1

                          else
                            0
                        , m.cmc
                        )
                      , ( Mana.coloredSymbols m.manaCost, Collate.key r.name )
                      )
                    , r
                    )

                Nothing ->
                    ( ( ( basic, 0, 0 ), ( 0, Collate.key r.name ) ), r )
        )
        >> List.sortBy Tuple.first
        >> List.map Tuple.second
