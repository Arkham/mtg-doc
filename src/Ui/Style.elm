module Ui.Style exposing (ariaSelected, aura, auraOfCards, cssVars)

import Dict
import Html exposing (Attribute)
import Html.Attributes exposing (attribute)
import List.Extra
import Types exposing (Card, Color, colorToString)


auraColor : String -> Maybe String
auraColor c =
    Dict.get c
        (Dict.fromList
            [ ( "W", "#f4e7b8" )
            , ( "U", "#3d9be9" )
            , ( "B", "#8f5bd8" )
            , ( "R", "#ec5a3a" )
            , ( "G", "#3dbb6c" )
            ]
        )


neutral : String
neutral =
    "#b9bfd0"


auraVars : List String -> List ( String, String )
auraVars colors =
    let
        at i =
            List.drop i colors |> List.head

        a =
            at 0 |> Maybe.withDefault neutral

        b =
            at 1 |> Maybe.withDefault a

        c =
            at 2 |> Maybe.withDefault b
    in
    [ ( "--aura-1", a ), ( "--aura-2", b ), ( "--aura-3", c ) ]


{-| Glow colors for a deck card, from the commander's color identity.
-}
aura : Maybe (List Color) -> Attribute msg
aura colors =
    case colors of
        Just (first :: rest) ->
            cssVars (auraVars (List.map (colorToString >> auraColor >> Maybe.withDefault "undefined") (first :: rest)))

        _ ->
            cssVars (auraVars [ neutral ])


{-| The commanders' colors, for the glow behind their cards.
-}
auraOfCards : List Card -> List ( String, String )
auraOfCards cards =
    let
        ids =
            cards |> List.concatMap .colorIdentity |> List.map colorToString |> List.Extra.unique
    in
    auraVars
        (if List.isEmpty ids then
            [ neutral ]

         else
            List.map (auraColor >> Maybe.withDefault neutral) ids
        )


ariaSelected : Bool -> Attribute msg
ariaSelected selected =
    attribute "aria-selected"
        (if selected then
            "true"

         else
            "false"
        )


{-| CSS custom properties as an inline style (Elm's `style` can't set them).
-}
cssVars : List ( String, String ) -> Attribute msg
cssVars vars =
    attribute "style" (String.join " " (List.map (\( k, v ) -> k ++ ": " ++ v ++ ";") vars))
