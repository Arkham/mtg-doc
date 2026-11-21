module RunCopy exposing (label, pill)

{-| What the tasks of an optimizer run are called, and what the pill over the map says while each
runs. A run's trace names its tasks by id only. The names are the same as shared/run-copy.ts's
(which the static build and the map use), kept so by test/unit/elm-parity.test.ts.
-}

import Dict exposing (Dict)


labels : List ( String, String )
labels =
    [ ( "start", "Load the deck" )
    , ( "spellbook", "Combos & bracket" )
    , ( "baseline", "Goldfish" )
    , ( "edhrec", "EDHREC" )
    , ( "baselineMana", "Mana base" )
    , ( "research", "Web research" )
    , ( "landPool", "Land options" )
    , ( "gameChangers", "Game Changers" )
    , ( "knownUpgrades", "Look up candidates" )
    , ( "upgrades", "Find upgrades" )
    , ( "review", "Review swaps" )
    , ( "verified", "Fix mana & verify" )
    , ( "submittedChecks", "Your list as submitted" )
    , ( "synergies", "Synergies" )
    , ( "draft", "How-to-play guides" )
    , ( "checked", "Contradictions" )
    , ( "saved", "Save" )
    ]


byId : Dict String String
byId =
    Dict.fromList labels


{-| A task's name, or its id for one this version doesn't know.
-}
label : String -> String
label id =
    Dict.get id byId |> Maybe.withDefault id


pills : Dict String String
pills =
    Dict.fromList
        [ ( "start", "Shuffling up" )
        , ( "spellbook", "Hunting for combos" )
        , ( "baseline", "Goldfishing 10,000 games" )
        , ( "edhrec", "Peeking at EDHREC" )
        , ( "baselineMana", "Counting pips" )
        , ( "research", "Reading up on your commander" )
        , ( "landPool", "Scouting lands" )
        , ( "gameChangers", "Checking the Game Changers" )
        , ( "knownUpgrades", "Pulling candidate cards" )
        , ( "upgrades", "Crunching the swaps" )
        , ( "review", "Second-guessing the swaps" )
        , ( "verified", "Fixing the mana" )
        , ( "submittedChecks", "Grading your list" )
        , ( "synergies", "Spotting synergies" )
        , ( "draft", "Writing your playbook" )
        , ( "checked", "Fact-checking itself" )
        , ( "saved", "Sleeving up the report" )
        ]


{-| What the pill says while a task runs.
-}
pill : String -> String
pill id =
    Dict.get id pills |> Maybe.withDefault (label id)
