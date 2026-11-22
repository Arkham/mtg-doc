module Ui.Bracket exposing (badge, names, panel)

import Dict
import Html exposing (Html, a, details, div, h2, h3, li, p, span, strong, summary, text, ul)
import Html.Attributes exposing (attribute, style)
import Html.Events exposing (preventDefaultOn)
import Json.Decode as D
import Types exposing (Bracket(..), BracketAssessmentPosition(..), BracketReport, Tone(..), bracketToInt)
import Ui.Attr exposing (class, href, rel, target, title)
import Ui.Card as Card


names : Bracket -> String
names bracket =
    case bracket of
        Bracket1 ->
            "Exhibition"

        Bracket2 ->
            "Core"

        Bracket3 ->
            "Upgraded"

        Bracket4 ->
            "Optimized"

        Bracket5 ->
            "cEDH"


toneLabel : Tone -> String
toneLabel tone =
    case tone of
        ToneMax ->
            "Max power"

        ToneBalanced ->
            "Balanced"

        ToneCasual ->
            "Casual"


positionLabel : BracketAssessmentPosition -> String
positionLabel position =
    case position of
        BracketAssessmentPositionLow ->
            "Low"

        BracketAssessmentPositionMid ->
            "Mid"

        BracketAssessmentPositionHigh ->
            "High"


spellbookTag : String -> String
spellbookTag tag =
    Dict.fromList
        [ ( "E", "Exhibition" )
        , ( "C", "Core" )
        , ( "O", "Oddball" )
        , ( "P", "Powerful" )
        , ( "S", "Spicy" )
        , ( "R", "Ruthless" )
        , ( "B", "Banned" )
        ]
        |> Dict.get tag
        |> Maybe.withDefault tag


badge : Bracket -> String -> Html msg
badge bracket size =
    let
        num =
            bracketToInt bracket
    in
    span
        [ class ("bracket-badge b" ++ String.fromInt num ++ " " ++ size)
        , title ("Bracket " ++ String.fromInt num ++ ": " ++ names bracket)
        ]
        [ text (String.fromInt num) ]


powerMeter : Float -> String -> Html msg
powerMeter power position =
    div [ class "power-meter", attribute "aria-label" ("Power " ++ String.fromFloat power ++ " of 100") ]
        [ div [ class "power-track" ]
            (div [ class "power-fill", style "width" (String.fromFloat power ++ "%") ] []
                :: List.map (\x -> span [ class "power-tick", style "left" (String.fromInt x ++ "%") ] []) [ 25, 40, 65, 90 ]
            )
        , div [ class "power-labels small muted" ]
            [ span [] [ text "casual" ]
            , span [] [ text ("power " ++ String.fromFloat power ++ " · " ++ position) ]
            , span [] [ text "cEDH" ]
            ]
        ]


{-| The bracket a deck fits, its checks, Game Changers and two-card combos. `actions` go in the
header, e.g. changing the target bracket; `toCombos` jumps to the report's combos section, which
lists them all (none when the page has no such section).
-}
panel : Card.Ctx msg -> BracketReport -> { actions : Maybe (Html msg), toCombos : Maybe msg } -> Html msg
panel ctx b { actions, toCombos } =
    let
        a_ =
            b.after

        limit =
            b.gameChangerLimit

        gameChangers =
            List.length a_.gameChangers

        slots =
            Maybe.withDefault (max gameChangers 0) limit

        twoCard =
            List.filter .twoCard a_.combos

        moved =
            b.before.bracket /= a_.bracket

        targetBracket =
            b.target

        bracket =
            a_.bracket

        options =
            List.filter (not << .inDeck) b.gameChangerOptions
    in
    div [ class "bracket-panel" ]
        [ div [ class "bracket-head" ]
            ([ badge a_.bracket "lg"
             , div [ class "bracket-title" ]
                [ h2 [] [ text ("Bracket " ++ String.fromInt (bracketToInt bracket) ++ ": " ++ names bracket) ]
                , div [ class "muted small" ]
                    [ text
                        ("Target "
                            ++ String.fromInt (bracketToInt targetBracket)
                            ++ " · "
                            ++ toneLabel b.tone
                            ++ " · "
                            ++ positionLabel a_.position
                            ++ " "
                            ++ names targetBracket
                            ++ (if moved then
                                    " · was bracket " ++ String.fromInt (bracketToInt b.before.bracket)

                                else
                                    ""
                               )
                            ++ (case a_.spellbookTag of
                                    Just tag ->
                                        if tag == "" then
                                            ""

                                        else
                                            " · Commander Spellbook: " ++ spellbookTag tag

                                    Nothing ->
                                        ""
                               )
                        )
                    ]
                ]
             ]
                ++ (case actions of
                        Just act ->
                            [ div [ class "bracket-actions" ] [ act ] ]

                        Nothing ->
                            []
                   )
            )
        , powerMeter a_.power (String.toLower (positionLabel a_.position))
        , ul [ class "checks" ]
            (List.map
                (\c ->
                    li
                        [ class
                            (if c.ok then
                                "ok"

                             else
                                "bad"
                            )
                        ]
                        [ span [ class "check-icon", attribute "aria-hidden" "true" ]
                            [ text
                                (if c.ok then
                                    "✓"

                                 else
                                    "✕"
                                )
                            ]
                        , strong [] [ text c.label ]
                        , span [ class "muted" ] [ text c.detail ]
                        ]
                )
                a_.checks
                ++ [ li [ class "ok" ]
                        [ span [ class "check-icon", attribute "aria-hidden" "true" ] [ text "⏱" ]
                        , strong [] [ text "Game length" ]
                        , span [ class "muted" ] [ text ("expect at least " ++ String.fromInt b.minTurns ++ " turns before anyone wins") ]
                        ]
                   ]
            )
        , div [ class "grid2 bracket-grid" ]
            [ div []
                ([ h3 []
                    [ text "Game Changers "
                    , span [ class "muted" ]
                        [ text
                            (String.fromInt gameChangers
                                ++ (case limit of
                                        Just l ->
                                            " / " ++ String.fromInt l

                                        Nothing ->
                                            ""
                                   )
                            )
                        ]
                    ]
                 , if slots == 0 && gameChangers == 0 then
                    p [ class "muted small" ] [ text "None allowed in this bracket." ]

                   else
                    div [ class "gc-slots" ]
                        (List.map (\g -> div [ class "gc-slot filled" ] [ Card.name ctx g ]) a_.gameChangers
                            ++ (case limit of
                                    Just l ->
                                        List.repeat (max 0 (l - gameChangers))
                                            (div [ class "gc-slot empty" ] [ text "open slot" ])

                                    Nothing ->
                                        []
                               )
                        )
                 ]
                    ++ (if not (List.isEmpty options) && limit /= Just 0 then
                            [ p [ class "small muted gc-options" ]
                                (text "Best others for this deck: "
                                    :: (options
                                            |> List.take 4
                                            |> List.indexedMap
                                                (\i g ->
                                                    span []
                                                        ((if i > 0 then
                                                            [ text " · " ]

                                                          else
                                                            []
                                                         )
                                                            ++ [ Card.name ctx g.name ]
                                                        )
                                                )
                                       )
                                )
                            ]

                        else
                            []
                       )
                )
            , if List.isEmpty twoCard then
                text ""

              else
                let
                    -- The ones most often assembled early matter most to the bracket; the combos section has the rest.
                    shownTwoCard =
                        twoCard
                            |> List.sortBy (\c -> -(Maybe.withDefault -1 c.earlyPct))
                            |> List.take 3
                in
                div []
                    [ h3 [] [ text "Two-card combos" ]
                    , ul [ class "combo-speed" ]
                        (List.map
                            (\c ->
                                li []
                                    (span []
                                        (Card.list ctx " + " c.cards
                                            ++ [ text "\u{00A0}"
                                               , a
                                                    [ href c.url
                                                    , target "_blank"
                                                    , rel "noreferrer"
                                                    , class "small spellbook-link"
                                                    , attribute "aria-label" "View combo on Commander Spellbook"
                                                    ]
                                                    [ text "↗" ]
                                               ]
                                        )
                                        :: (case c.earlyPct of
                                                Just pct ->
                                                    [ span
                                                        [ class
                                                            ("small "
                                                                ++ (if pct > 15 then
                                                                        "warn"

                                                                    else
                                                                        "muted"
                                                                   )
                                                            )
                                                        ]
                                                        [ text (String.fromFloat pct ++ "% of games assembled before turn " ++ String.fromInt b.minTurns) ]
                                                    ]

                                                Nothing ->
                                                    []
                                           )
                                    )
                            )
                            shownTwoCard
                        )
                    , case toCombos of
                        Just jump ->
                            a [ class "small combo-speed-more", href "#combos", preventDefaultOn "click" (D.succeed ( jump, True )) ]
                                [ text
                                    (if List.length twoCard > List.length shownTwoCard then
                                        "See all " ++ String.fromInt (List.length twoCard) ++ " in Combos ↓"

                                     else
                                        "See them in Combos ↓"
                                    )
                                ]

                        Nothing ->
                            text ""
                    ]
            ]
        , if List.isEmpty b.excluded then
            text ""

          else
            details [ class "excluded" ]
                [ summary []
                    [ text
                        (String.fromInt (List.length b.excluded)
                            ++ " strong "
                            ++ (if List.length b.excluded == 1 then
                                    "card"

                                else
                                    "cards"
                               )
                            ++ " skipped to stay within your limits"
                        )
                    ]
                , ul []
                    (List.map
                        (\e -> li [] [ Card.name ctx e.name, text " ", span [ class "muted small" ] [ text ("· " ++ e.reason) ] ])
                        b.excluded
                    )
                ]
        ]
