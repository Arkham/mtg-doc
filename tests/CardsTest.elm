module CardsTest exposing (suite)

import Cards
import Collate
import Expect
import Test exposing (Test, describe, test)
import Ui.Mana exposing (symbolUrl)


suite : Test
suite =
    describe "Cards"
        [ test "sortByManaValue sorts by mana value, then name; unknown cards count as zero" <|
            \_ ->
                [ { name = "Wrath", card = Just { cmc = 4, manaCost = "{2}{W}{W}" } }
                , { name = "Sol Ring", card = Just { cmc = 1, manaCost = "{1}" } }
                , { name = "Arcane Signet", card = Just { cmc = 2, manaCost = "{2}" } }
                , { name = "Mind Stone", card = Just { cmc = 2, manaCost = "{2}" } }
                , { name = "Typo", card = Nothing }
                ]
                    |> Cards.sortByManaValue (.card >> Maybe.map (\c -> { cmc = c.cmc, manaCost = c.manaCost }))
                    |> List.map .name
                    |> Expect.equal [ "Typo", "Sol Ring", "Arcane Signet", "Mind Stone", "Wrath" ]
        , test "sortByManaValue puts basic lands after the other lands" <|
            \_ ->
                [ { name = "Forest", card = Just { cmc = 0, manaCost = "" } }
                , { name = "Command Tower", card = Just { cmc = 0, manaCost = "" } }
                , { name = "Snow-Covered Island", card = Just { cmc = 0, manaCost = "" } }
                , { name = "Swamp", card = Just { cmc = 0, manaCost = "" } }
                , { name = "Woodland Cemetery", card = Just { cmc = 0, manaCost = "" } }
                ]
                    |> Cards.sortByManaValue (.card >> Maybe.map (\c -> { cmc = c.cmc, manaCost = c.manaCost }))
                    |> List.map .name
                    |> Expect.equal [ "Command Tower", "Woodland Cemetery", "Forest", "Snow-Covered Island", "Swamp" ]
        , test "sortByManaValue puts cards with X in their mana cost last" <|
            \_ ->
                [ { name = "Fireball", card = Just { cmc = 1, manaCost = "{X}{R}" } }
                , { name = "Opt", card = Just { cmc = 1, manaCost = "{U}" } }
                , { name = "Walking Ballista", card = Just { cmc = 0, manaCost = "{X}{X}" } }
                , { name = "Ornithopter", card = Just { cmc = 0, manaCost = "{0}" } }
                ]
                    |> Cards.sortByManaValue (.card >> Maybe.map (\c -> { cmc = c.cmc, manaCost = c.manaCost }))
                    |> List.map .name
                    |> Expect.equal [ "Ornithopter", "Opt", "Walking Ballista", "Fireball" ]
        , test "sortByManaValue puts cards with fewer colored symbols first at the same mana value" <|
            \_ ->
                [ { name = "Counterspell", card = Just { cmc = 2, manaCost = "{U}{U}" } }
                , { name = "Mana Leak", card = Just { cmc = 2, manaCost = "{1}{U}" } }
                , { name = "Remove Soul", card = Just { cmc = 2, manaCost = "{1}{U}" } }
                , { name = "Essence Scatter", card = Just { cmc = 2, manaCost = "{1}{U}" } }
                ]
                    |> Cards.sortByManaValue (.card >> Maybe.map (\c -> { cmc = c.cmc, manaCost = c.manaCost }))
                    |> List.map .name
                    |> Expect.equal [ "Essence Scatter", "Mana Leak", "Remove Soul", "Counterspell" ]
        , test "names sort like localeCompare: case and accents only break ties, punctuation first" <|
            \_ ->
                [ "Lim-Dûl's Vault", "limb", "Limit", "Lim-Dul's Vault", "Æther Vial", "Aetherflux", "Ajani", "aether", "Assassin's Trophy", "Assassins" ]
                    |> Collate.sortBy identity
                    |> Expect.equal [ "aether", "Æther Vial", "Aetherflux", "Ajani", "Assassin's Trophy", "Assassins", "Lim-Dul's Vault", "Lim-Dûl's Vault", "limb", "Limit" ]
        , test "symbols are served from the site, including ones whose file name differs" <|
            \_ ->
                List.map (symbolUrl "./") [ "G", "2/W", "½", "∞" ]
                    |> Expect.equal [ "./symbols/G.svg", "./symbols/2W.svg", "./symbols/HALF.svg", "./symbols/INFINITY.svg" ]
        , test "symbols not bundled yet come from Scryfall" <|
            \_ -> Expect.equal (symbolUrl "./" "Z/Q") "https://svgs.scryfall.io/card-symbols/ZQ.svg"
        ]
