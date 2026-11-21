module HowToPlay exposing (view)

{-| How to play the deck on screen, and what to tell the table in the pre-game (Rule 0) talk: a
dialog over the page, full screen on phones and a centered panel on larger screens.
-}

import Html exposing (Html, button, div, h1, h2, h3, header, li, node, ol, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, style)
import Html.Events exposing (onClick)
import Json.Decode as D
import Types exposing (BracketAssessmentPosition(..), PlayGuide, Report)
import Ui.Attr exposing (class, id)
import Ui.Bracket as Bracket
import Ui.Card as Card
import Ui.Mana as Mana


{-| The dialog for a report as it applies to the deck on screen, with that deck's guide.
-}
view : { base : String, titleId : String, onClose : msg, ctx : Card.Ctx msg } -> Report -> Maybe PlayGuide -> Html msg
view opts r guide =
    let
        cmdr =
            List.head r.commanderCards

        assessed =
            Maybe.map .after r.bracket
    in
    div
        [ class "modal-backdrop"
        , Html.Events.on "click"
            (D.at [ "target", "className" ] D.string
                |> D.andThen
                    (\target ->
                        -- Only a click on the backdrop itself, not on the dialog.
                        if target == "modal-backdrop" then
                            D.succeed opts.onClose

                        else
                            D.fail "inside"
                    )
            )
        ]
        [ div [ class "modal", attribute "role" "dialog", attribute "aria-modal" "true", attribute "aria-labelledby" opts.titleId ]
            [ header [ class "modal-head" ]
                [ h2 [ id opts.titleId ] [ text "How to play" ]
                , button [ class "modal-close", onClick opts.onClose ]
                    [ text "Close", node "mtg-focus" [ attribute "restore" "" ] [] ]
                ]
            , div [ class "modal-body" ]
                [ div [ class "play" ]
                    [ case cmdr |> Maybe.andThen .imageArt of
                        Just art ->
                            div [ class "rule0-art", style "background-image" ("url(" ++ art ++ ")") ] []

                        Nothing ->
                            text ""
                    , div [ class "play-content" ]
                        (div [ class "play-top" ]
                            [ case assessed of
                                Just a ->
                                    Bracket.badge a.bracket "lg"

                                Nothing ->
                                    text ""
                            , div []
                                [ case assessed of
                                    Just a ->
                                        div [ class "rule0-kicker" ]
                                            [ text ("Bracket " ++ String.fromFloat a.bracket ++ " · " ++ Bracket.names (round a.bracket)) ]

                                    Nothing ->
                                        text ""
                                , h1 []
                                    (text (String.join " + " r.commanders ++ " ")
                                        :: List.map (\c -> Mana.cost opts.base 22 (Just c.manaCost)) r.commanderCards
                                    )
                                ]
                            ]
                            :: (case guide of
                                    Just g ->
                                        guideView opts.ctx g

                                    Nothing ->
                                        [ p [ class "muted" ] [ text "There's no playing guide for this deck yet." ] ]
                               )
                            ++ [ atTheTable opts.ctx r ]
                        )
                    ]
                ]
            ]
        , node "mtg-scroll-lock" [] []
        ]


bullets : Card.Ctx msg -> List String -> Html msg
bullets ctx items =
    ul [ class "play-bullets" ] (List.map (\x -> li [] (Card.prose ctx x)) items)


guideView : Card.Ctx msg -> PlayGuide -> List (Html msg)
guideView ctx g =
    let
        phases =
            [ ( "Early game", "Turns 1-3", g.early )
            , ( "Mid game", "Building up", g.mid )
            , ( "Late game", "Closing it out", g.late )
            ]
                |> List.filter (\( _, _, items ) -> not (List.isEmpty items))
    in
    List.concat
        [ [ p [ class "play-summary" ] (Card.prose ctx g.summary) ]
        , if List.isEmpty phases then
            []

          else
            [ ol [ class "play-phases" ]
                (List.map
                    (\( title, sub, items ) ->
                        li []
                            [ h3 [] [ text (title ++ " "), span [] [ text sub ] ]
                            , bullets ctx items
                            ]
                    )
                    phases
                )
            ]
        , if List.isEmpty g.winConditions then
            []

          else
            [ section [] [ h3 [] [ text "How it wins" ], bullets ctx g.winConditions ] ]
        , if List.isEmpty g.keyCards then
            []

          else
            [ section []
                [ h3 [] [ text "Key cards" ]
                , ul [ class "play-cards" ]
                    (List.map (\k -> li [] [ Card.name ctx k.name, span [] (Card.prose ctx k.why) ]) g.keyCards)
                ]
            ]
        , if g.mulligan == "" then
            []

          else
            [ p [ class "play-mulligan" ] (strong [] [ text "Keep or mulligan?" ] :: text " " :: Card.prose ctx g.mulligan) ]
        , if List.isEmpty g.watchOut then
            []

          else
            [ section [] [ h3 [] [ text "Watch out for" ], bullets ctx g.watchOut ] ]
        ]


{-| What the table should know before the game: bracket, game length, Game Changers, combos.
-}
atTheTable : Card.Ctx msg -> Report -> Html msg
atTheTable ctx r =
    case r.bracket of
        Nothing ->
            text ""

        Just b ->
            let
                a =
                    b.after

                combos =
                    List.filter .twoCard a.combos

                position =
                    case a.position of
                        BracketAssessmentPositionHigh ->
                            "High"

                        BracketAssessmentPositionMid ->
                            "Mid"

                        BracketAssessmentPositionLow ->
                            "Low"
            in
            section [ class "play-table" ]
                (List.concat
                    [ [ h3 [] [ text "At the table" ]
                      , div [ class "rule0-facts" ]
                            [ fact "Game length" (String.fromFloat b.minTurns ++ "+ turns")
                            , fact "Power" (position ++ " " ++ Bracket.names (round a.bracket))
                            , fact "Game Changers" (String.fromInt (List.length a.gameChangers))
                            , fact "Two-card combos" (String.fromInt (List.length combos))
                            ]
                      ]
                    , if List.isEmpty a.gameChangers then
                        []

                      else
                        [ p [ class "rule0-list" ] (span [ class "muted" ] [ text "Game Changers: " ] :: Card.list ctx " · " a.gameChangers) ]
                    , if List.isEmpty combos then
                        []

                      else
                        [ ul [ class "rule0-combos" ]
                            (List.map
                                (\c ->
                                    li []
                                        [ strong [] (Card.list ctx " + " c.cards)
                                        , span [] [ text (String.join ", " (List.take 2 c.produces)) ]
                                        ]
                                )
                                combos
                            )
                        ]
                    , if List.isEmpty a.massLandDenial && List.isEmpty a.extraTurns then
                        []

                      else
                        [ p [ class "rule0-list" ] (span [ class "muted" ] [ text "Heads up: " ] :: Card.list ctx " · " (a.massLandDenial ++ a.extraTurns)) ]
                    , if List.isEmpty a.gameChangers && List.isEmpty combos then
                        [ p [ class "rule0-clean" ] [ text "No Game Changers, no two-card combos, no land destruction." ] ]

                      else
                        []
                    ]
                )


fact : String -> String -> Html msg
fact label value =
    div [] [ span [] [ text label ], strong [] [ text value ] ]
