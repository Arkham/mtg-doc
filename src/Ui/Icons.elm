module Ui.Icons exposing (chevronLeft, lock, search, trash)

import Html exposing (Html)
import Html.Attributes
import Svg exposing (Svg, svg)
import Svg.Attributes as A


icon : String -> List (Svg msg) -> Html msg
icon strokeWidth =
    svg
        [ A.width "18"
        , A.height "18"
        , A.viewBox "0 0 24 24"
        , A.fill "none"
        , A.stroke "currentColor"
        , A.strokeWidth strokeWidth
        , A.strokeLinecap "round"
        , A.strokeLinejoin "round"
        , Html.Attributes.attribute "aria-hidden" "true"
        ]


lock : Bool -> Html msg
lock locked =
    icon "2"
        [ Svg.rect
            [ A.x "4"
            , A.y "11"
            , A.width "16"
            , A.height "10"
            , A.rx "2"
            , A.fill
                (if locked then
                    "currentColor"

                 else
                    "none"
                )
            ]
            []
        , Svg.path
            [ A.d
                (if locked then
                    "M8 11V7a4 4 0 0 1 8 0v4"

                 else
                    "M8 11V7a4 4 0 0 1 7.5-1.9"
                )
            ]
            []
        ]


trash : Html msg
trash =
    icon "2" [ Svg.path [ A.d "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" ] [] ]


search : Html msg
search =
    icon "2"
        [ Svg.circle [ A.cx "11", A.cy "11", A.r "7" ] []
        , Svg.path [ A.d "m20 20-3.5-3.5" ] []
        ]


chevronLeft : Html msg
chevronLeft =
    icon "2.5" [ Svg.path [ A.d "m15 5-7 7 7 7" ] [] ]
