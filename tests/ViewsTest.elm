module ViewsTest exposing (suite)

import Expect
import Json.Decode as D
import Route exposing (DeckView(..))
import Test exposing (Test, describe, test)
import Types exposing (Report, reportDecoder)
import Views exposing (shown, viewOf)


{-| A minimal report: what's needed to tell the two views apart.
-}
report : Report
report =
    """
    {"slug":"x","commanders":[],"commanderCards":[],"generatedAt":"","model":null,"strategy":"","themes":[],
     "swaps":[{"out":"Old","in":"New","category":"other","reason":""}],
     "before":SNAP99,"after":SNAP100,
     "combosPresent":[{"id":"x","cards":[],"missing":[],"produces":[],"description":"","bracketTag":null,"url":""}],
     "combosOneAway":[],"research":null,"edhrec":null,"warnings":[],
     "options":{"maxSwaps":1,"budgetPerCard":null,"budgetTotal":null,"bracket":null,"tone":"max","locked":[],"webResearch":false},
     "decklist":[CARD_NEW],"cardIndex":{},
     "original":{"decklist":[CARD_OLD,CARD_KEEP],"combosPresent":[],"combosOneAway":[]},
     "synergies":[{"title":"kept","cards":["Old","Keep"],"explanation":""},{"title":"needs new card","cards":["New","Keep"],"explanation":""}]
    }
    """
        |> String.replace "SNAP99" (snapshot 99)
        |> String.replace "SNAP100" (snapshot 100)
        |> String.replace "CARD_NEW" (card "New")
        |> String.replace "CARD_OLD" (card "Old")
        |> String.replace "CARD_KEEP" (card "Keep")
        |> D.decodeString reportDecoder
        |> Result.mapError D.errorToString
        |> (\r ->
                case r of
                    Ok v ->
                        v

                    Err e ->
                        Debug.todo e
           )


snapshot : Int -> String
snapshot n =
    """{"mana":{"landCount":0,"mdfcLands":0,"recommendedLands":0,"avgCmc":0,"curve":{},"colors":[],"tappedLands":[],"colorlessLands":[],"basics":{},"rampCount":0,"issues":[]},
        "sim":{"games":0,"mulliganRate":0,"landDropByTurn":{},"commanderOnCurve":0,"commanderByTurn":{},"allColorsByTurn3":0,"avgManaTurn4":0,"screwRate":0,"floodRate":0},
        "roles":[],"totalCards":N,"totalPriceUsd":0}"""
        |> String.replace "N" (String.fromInt n)


card : String -> String
card name =
    """{"name":"NAME","qty":1,"group":"Other","cmc":0,"image":null,"scryfallUri":"","priceUsd":null,"isNew":false,"delta":0}"""
        |> String.replace "NAME" name


suite : Test
suite =
    describe "Views"
        [ test "the deck as submitted has nothing to compare, and no suggestions" <|
            \_ ->
                let
                    o =
                        shown report Current
                in
                Expect.equal
                    ( ( o.suggested, o.deck.totalCards )
                    , ( List.map .name o.decklist, o.combosPresent, List.map .title o.synergies )
                    )
                    ( ( Nothing, 99 ), ( [ "Old", "Keep" ], [], [ "kept" ] ) )
        , test "the suggested deck is compared with the deck as submitted, with the swaps that made it" <|
            \_ ->
                let
                    o =
                        shown report Optimized
                in
                Expect.equal
                    ( ( o.deck.totalCards, o.suggested |> Maybe.map (.before >> .totalCards) )
                    , ( o.suggested |> Maybe.map (.swaps >> List.map .in_), List.map .name o.decklist, List.length o.synergies )
                    )
                    ( ( 100, Just 99 ), ( Just [ "New" ], [ "New" ], 2 ) )
        , test "a deck published without suggestions shows none, even when asked for the suggested view" <|
            \_ -> Expect.equal (shown { report | suggestionsHidden = True } Optimized).suggested Nothing
        , test "a published deck with its suggestions offers both views" <|
            \_ -> Expect.equal ( viewOf report Optimized, viewOf report Current ) ( Optimized, Current )
        , test "a deck published without suggestions only has the view of the deck as submitted" <|
            \_ -> Expect.equal (viewOf { report | suggestionsHidden = True } Optimized) Current
        ]
