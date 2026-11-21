module CombosTest exposing (suite)

import Combos exposing (groupByMissing, outcome)
import Expect
import Test exposing (Test, describe, test)
import Types exposing (Combo)


combo : String -> List String -> String -> List String -> Combo
combo id cards missing produces =
    { id = id
    , cards = cards
    , missing = [ missing ]
    , produces = produces
    , description = ""
    , bracketTag = Nothing
    , url = "https://example.test/" ++ id
    }


suite : Test
suite =
    describe "Combos"
        [ test "outcome picks the result that matters most" <|
            \_ ->
                Expect.equal
                    [ outcome
                        [ "Infinite +1/+1 counters on a creature"
                        , "Near-infinite card draw for target opponent"
                        , "Near-infinite damage"
                        , "Target opponent loses the game"
                        ]
                    , outcome [ "Infinite colorless mana", "Infinite storm count" ]
                    , outcome [ "Near-infinite lifeloss", "Near-infinite card draw" ]
                    , outcome [ "Infinite card draw", "Infinite draw triggers" ]
                    , outcome [ "Exile your library" ]
                    ]
                    [ "Kills an opponent", "Infinite mana", "Near-infinite damage", "Infinite draw", "Exile your library" ]
        , test "groupByMissing shows each missing card once, with its partners, most combos first" <|
            \_ ->
                let
                    groups =
                        groupByMissing
                            [ combo "1" [ "Hullbreaker Horror", "Sol Ring" ] "Hullbreaker Horror" [ "Infinite colorless mana" ]
                            , combo "2" [ "Orcish Bowmasters", "Peer into the Abyss" ] "Peer into the Abyss" [ "Near-infinite damage" ]
                            , combo "3" [ "Peer into the Abyss", "Underworld Dreams" ] "Peer into the Abyss" [ "Target opponent loses the game" ]
                            , combo "4" [ "Nekusar", "Psychosis Crawler", "Curiosity" ] "Curiosity" [ "Infinite card draw" ]
                            ]
                in
                Expect.equal
                    ( List.map (\g -> ( g.name, List.length g.combos, g.best )) groups
                    , List.map (\g -> List.map .partners g.combos) groups
                    )
                    ( [ ( "Peer into the Abyss", 2, "Kills an opponent" )
                      , ( "Hullbreaker Horror", 1, "Infinite mana" )
                      , ( "Curiosity", 1, "Infinite draw" )
                      ]
                      -- Partners exclude the missing card; strongest combo first.
                    , [ [ [ "Underworld Dreams" ], [ "Orcish Bowmasters" ] ]
                      , [ [ "Sol Ring" ] ]
                      , [ [ "Nekusar", "Psychosis Crawler" ] ]
                      ]
                    )
        ]
