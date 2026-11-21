module Ui.Settings exposing (summary, view)

{-| The optimizer's settings: on the review before a deck's first run, and on its report to run
it again.
-}

import Html exposing (Html, button, div, input, label, option, select, span, text)
import Html.Attributes exposing (attribute, checked, disabled, selected, value)
import Html.Events exposing (on, onCheck, onClick, onInput)
import Json.Decode as D
import Types exposing (OptimizeOptions, Tone(..), toneToString)
import Ui.Attr exposing (class, placeholder, type_)
import Ui.Style exposing (ariaSelected)


{-| The settings in a line: "up to 12 swaps · deck ≤ $300 · bracket 3 · max power".
-}
summary : OptimizeOptions -> String
summary o =
    [ Just ("up to " ++ String.fromFloat o.maxSwaps ++ " swaps")
    , o.budgetTotal |> Maybe.andThen nonZero |> Maybe.map (\b -> "deck ≤ $" ++ String.fromFloat b)
    , o.budgetPerCard |> Maybe.andThen nonZero |> Maybe.map (\b -> "≤ $" ++ String.fromFloat b ++ "/card")
    , if (o.budgetTotal |> Maybe.andThen nonZero) == Nothing && (o.budgetPerCard |> Maybe.andThen nonZero) == Nothing then
        Just "any budget"

      else
        Nothing
    , Just
        (case o.bracket |> Maybe.andThen nonZero of
            Just b ->
                "bracket " ++ String.fromFloat b

            Nothing ->
                "current bracket"
        )
    , Just
        (if o.tone == ToneMax then
            "max power"

         else
            toneToString o.tone
        )
    , if o.webResearch then
        Just "web research"

      else
        Nothing
    ]
        |> List.filterMap identity
        |> String.join " · "


{-| The settings to change, each a field in a grid. `webResearch` says whether it's on offer
(it needs an LLM).
-}
view : { webResearch : Bool, onChange : OptimizeOptions -> msg } -> OptimizeOptions -> Html msg
view config o =
    let
        set =
            config.onChange

        optional s =
            if s == "" then
                Nothing

            else
                Just (number s)

        money =
            Maybe.map String.fromFloat >> Maybe.withDefault ""
    in
    div [ class "grid4" ]
        [ label [ class "field" ]
            [ span [] [ text "Max swaps" ]
            , input
                [ type_ "number"
                , attribute "inputmode" "numeric"
                , Ui.Attr.min "1"
                , Ui.Attr.max "40"
                , value (String.fromFloat o.maxSwaps)
                , Ui.Attr.valueAttr (String.fromFloat o.maxSwaps)
                , onInput (\v -> set { o | maxSwaps = number v })
                ]
                []
            ]
        , label [ class "field" ]
            [ span [] [ text "Deck budget ($)" ]
            , input
                [ type_ "number"
                , attribute "inputmode" "decimal"
                , Ui.Attr.min "0"
                , placeholder "No limit"
                , value (money o.budgetTotal)
                , Ui.Attr.valueAttr (money o.budgetTotal)
                , onInput (\v -> set { o | budgetTotal = optional v })
                ]
                []
            ]
        , label [ class "field" ]
            [ span [] [ text "Max per card ($)" ]
            , input
                [ type_ "number"
                , attribute "inputmode" "decimal"
                , Ui.Attr.min "0"
                , placeholder "No limit"
                , value (money o.budgetPerCard)
                , Ui.Attr.valueAttr (money o.budgetPerCard)
                , onInput (\v -> set { o | budgetPerCard = optional v })
                ]
                []
            ]
        , label [ class "field" ]
            [ span [] [ text "Target bracket" ]
            , select [ on "change" (D.map (\v -> set { o | bracket = optional v }) (D.at [ "target", "value" ] D.string)) ]
                (List.map
                    (\( v, l ) -> option [ Ui.Attr.optionValue v, selected ((o.bracket |> Maybe.map String.fromFloat |> Maybe.withDefault "") == v) ] [ text l ])
                    [ ( "", "Stay in current bracket" )
                    , ( "1", "1: Exhibition" )
                    , ( "2", "2: Core" )
                    , ( "3", "3: Upgraded" )
                    , ( "4", "4: Optimized" )
                    , ( "5", "5: cEDH" )
                    ]
                )
            ]
        , div [ class "field" ]
            [ span [] [ text "Push" ]
            , div [ class "segmented" ]
                (List.map
                    (\( t, l ) -> button [ ariaSelected (o.tone == t), onClick (set { o | tone = t }) ] [ text l ])
                    [ ( ToneMax, "Max" ), ( ToneBalanced, "Balanced" ), ( ToneCasual, "Casual" ) ]
                )
            ]
        , label [ class "field checkbox" ]
            [ input [ type_ "checkbox", checked o.webResearch, disabled (not config.webResearch), onCheck (\c -> set { o | webResearch = c }) ] []
            , span []
                (text "Web research"
                    :: (if config.webResearch then
                            []

                        else
                            [ span [ class "muted small" ] [ text " (needs an LLM)" ] ]
                       )
                )
            ]
        ]


number : String -> Float
number s =
    String.toFloat s |> Maybe.withDefault 0


nonZero : Float -> Maybe Float
nonZero n =
    if n == 0 then
        Nothing

    else
        Just n
