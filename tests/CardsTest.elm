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
                [ { name = "Wrath", card = Just { cmc = 4 } }
                , { name = "Sol Ring", card = Just { cmc = 1 } }
                , { name = "Arcane Signet", card = Just { cmc = 2 } }
                , { name = "Mind Stone", card = Just { cmc = 2 } }
                , { name = "Typo", card = Nothing }
                ]
                    |> Cards.sortByManaValue (.card >> Maybe.map .cmc)
                    |> List.map .name
                    |> Expect.equal [ "Typo", "Sol Ring", "Arcane Signet", "Mind Stone", "Wrath" ]
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
