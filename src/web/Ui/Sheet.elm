module Ui.Sheet exposing
    ( Config
    , Dir
    , Drag
    , Model
    , Msg
    , Shown
    , gallery
    , keys
    , open
    , update
    , view
    )

{-| Full-screen image viewer: card previews on touch devices, a gallery's cards (swipe, arrow keys
or the side buttons move between them), photo zoom and the commander's foil card.
-}

import Html exposing (Attribute, Html, a, button, div, img, node, span, text)
import Html.Attributes exposing (attribute, disabled, draggable, style)
import Html.Events exposing (on, stopPropagationOn)
import Html.Keyed as Keyed
import Json.Decode as D
import Ui.Attr exposing (alt, class, href, rel, src, target)
import Ui.Card exposing (Item)
import Ui.Gallery as Gallery exposing (Gallery)
import Ui.Keys as Keys
import Ui.Style exposing (cssVars)


{-| Horizontal travel, in px, that turns a drag into a swipe to the neighbouring card.
-}
swipePx : Float
swipePx =
    60


type alias Config =
    { src : String
    , alt : String
    , link : { href : String, label : String }
    , wide : Bool
    , foil : Maybe (List ( String, String ))
    }


type alias Drag =
    { id : Int, x : Float, y : Float, horizontal : Maybe Bool }


type Dir
    = Next
    | Prev


{-| What the sheet shows: one image, or a gallery's cards with one in view.
-}
type Shown
    = Single Config
    | Cards (Gallery Item)


type alias Model =
    { shown : Shown
    , dx : Float
    , enter : Maybe Dir
    , drag : Maybe Drag
    , swallowClick : Bool
    }


type Msg
    = Close
    | Go Dir
    | Down Int String Int Float Float
    | Move Int Float Float
    | Up Int Float
    | Cancel
    | BackdropClick
    | Ignore


init : Shown -> Model
init shown =
    { shown = shown, dx = 0, enter = Nothing, drag = Nothing, swallowClick = False }


open : Config -> Model
open config =
    init (Single config)


gallery : Gallery Item -> Model
gallery cards =
    init (Cards cards)


configOf : Shown -> Config
configOf shown =
    case shown of
        Single config ->
            config

        Cards cards ->
            itemConfig (Gallery.current cards)


itemConfig : Item -> Config
itemConfig item =
    { src = item.image
    , alt = item.name
    , link = { href = item.href, label = "Scryfall ↗" }
    , wide = False
    , foil = Nothing
    }


{-| The sheet after a message; Nothing once it closes.
-}
update : Msg -> Model -> Maybe Model
update msg model =
    case msg of
        Close ->
            Nothing

        Go dir ->
            Just (go dir model)

        Down id pointerType button x y ->
            if pointerType == "mouse" && button /= 0 then
                Just model

            else
                Just { model | drag = Just { id = id, x = x, y = y, horizontal = Nothing } }

        Move id x y ->
            case model.drag of
                Just d ->
                    if d.id /= id then
                        Just model

                    else
                        let
                            mx =
                                x - d.x

                            horizontal =
                                case d.horizontal of
                                    Nothing ->
                                        let
                                            my =
                                                y - d.y
                                        in
                                        if sqrt (mx * mx + my * my) > 8 then
                                            Just (abs mx > abs my)

                                        else
                                            Nothing

                                    h ->
                                        h

                            drag =
                                Just { d | horizontal = horizontal }
                        in
                        if horizontal == Just True then
                            let
                                -- Resist past the ends so there's feedback without implying another card.
                                blocked =
                                    (mx < 0 && step Next model == Nothing) || (mx > 0 && step Prev model == Nothing)
                            in
                            Just
                                { model
                                    | drag = drag
                                    , dx =
                                        if blocked then
                                            mx / 4

                                        else
                                            mx
                                }

                        else
                            Just { model | drag = drag }

                Nothing ->
                    Just model

        Up id x ->
            case model.drag of
                Just d ->
                    if d.id /= id then
                        Just model

                    else if d.horizontal /= Just True then
                        Just { model | drag = Nothing }

                    else
                        let
                            mx =
                                x - d.x

                            settled =
                                { model | drag = Nothing, swallowClick = True, dx = 0 }
                        in
                        if mx <= -swipePx then
                            Just (go Next settled)

                        else if mx >= swipePx then
                            Just (go Prev settled)

                        else
                            Just settled

                Nothing ->
                    Just model

        Cancel ->
            Just { model | drag = Nothing, dx = 0 }

        BackdropClick ->
            -- A drag ends with a click on the backdrop, which would otherwise close the sheet.
            if model.swallowClick then
                Just { model | swallowClick = False }

            else
                Nothing

        Ignore ->
            Just model


{-| The gallery moved one card along, if there's one that way.
-}
step : Dir -> Model -> Maybe (Gallery Item)
step dir model =
    case model.shown of
        Cards cards ->
            case dir of
                Next ->
                    Gallery.next cards

                Prev ->
                    Gallery.prev cards

        Single _ ->
            Nothing


go : Dir -> Model -> Model
go dir model =
    case step dir model of
        Just cards ->
            { model | enter = Just dir, shown = Cards cards }

        Nothing ->
            model


{-| Escape closes the sheet; the arrow keys move through a gallery.
-}
keys : D.Decoder Msg
keys =
    Keys.onKeys [ ( "Escape", Close ), ( "ArrowRight", Go Next ), ( "ArrowLeft", Go Prev ) ]


stop : msg -> Attribute msg
stop msg =
    stopPropagationOn "click" (D.succeed ( msg, True ))


pointer : (Int -> Float -> Float -> msg) -> D.Decoder msg
pointer toMsg =
    D.map3 toMsg
        (D.field "pointerId" D.int)
        (D.field "clientX" D.float)
        (D.field "clientY" D.float)


view : (Msg -> msg) -> Model -> Html msg
view lift model =
    let
        c =
            configOf model.shown

        isGallery =
            case model.shown of
                Cards _ ->
                    True

                Single _ ->
                    False

        swipe =
            if isGallery then
                [ on "pointerdown"
                    (D.map5 Down
                        (D.field "pointerId" D.int)
                        (D.field "pointerType" D.string)
                        (D.field "button" D.int)
                        (D.field "clientX" D.float)
                        (D.field "clientY" D.float)
                    )
                , on "pointermove" (pointer Move)
                , on "pointerup" (pointer (\id x _ -> Up id x))
                , on "pointercancel" (D.succeed Cancel)
                ]

            else
                []

        image =
            case c.foil of
                Just vars ->
                    -- Taps on the card tilt it instead of closing; the backdrop and Close button still close.
                    div [ class "sheet-card tilt", cssVars vars, stop Ignore ]
                        [ img [ src c.src, alt c.alt ] []
                        , span [ class "foil", attribute "aria-hidden" "true" ] []
                        , node "mtg-tilt" [ attribute "touch" "" ] []
                        ]

                Nothing ->
                    let
                        dragging =
                            model.dx /= 0
                    in
                    img
                        ([ src c.src
                         , alt c.alt
                         , draggable "false"
                         , class
                            (String.join " "
                                (List.filterMap identity
                                    [ if c.wide then
                                        Just "wide"

                                      else
                                        Nothing
                                    , Maybe.map
                                        (\d ->
                                            case d of
                                                Next ->
                                                    "enter-next"

                                                Prev ->
                                                    "enter-prev"
                                        )
                                        model.enter
                                    , if dragging then
                                        Just "dragging"

                                      else
                                        Nothing
                                    ]
                                )
                            )
                         ]
                            ++ (if dragging then
                                    [ style "transform"
                                        ("translateX("
                                            ++ String.fromFloat model.dx
                                            ++ "px) rotate("
                                            ++ String.fromFloat (model.dx / 40)
                                            ++ "deg)"
                                        )
                                    , style "opacity" (String.fromFloat (max 0.4 (1 - abs model.dx / 600)))
                                    ]

                                else
                                    []
                               )
                        )
                        []

        nav =
            if isGallery then
                [ button
                    [ class "sheet-nav prev"
                    , attribute "aria-label" "Previous card"
                    , disabled (step Prev model == Nothing)
                    , stop (Go Prev)
                    ]
                    [ text "‹" ]
                , button
                    [ class "sheet-nav next"
                    , attribute "aria-label" "Next card"
                    , disabled (step Next model == Nothing)
                    , stop (Go Next)
                    ]
                    [ text "›" ]
                ]

            else
                []

        position =
            case model.shown of
                Cards cards ->
                    let
                        ( at, count ) =
                            Gallery.position cards
                    in
                    [ span [ class "sheet-position" ]
                        [ text (String.fromInt at ++ " / " ++ String.fromInt count) ]
                    ]

                Single _ ->
                    []

        neighbours =
            case model.shown of
                Cards cards ->
                    -- Warm the neighbours so a swipe lands on a loaded image.
                    [ node "mtg-preload"
                        [ attribute "srcs" (Gallery.neighbours cards |> List.map .image |> String.join " ") ]
                        []
                    ]

                Single _ ->
                    []
    in
    Html.map lift
        (Keyed.node "div"
            ([ class
                ("card-sheet "
                    ++ (if isGallery then
                            "gallery"

                        else
                            ""
                       )
                )
             , Html.Events.onClick BackdropClick
             , attribute "role" "dialog"
             , attribute "aria-label" c.alt
             ]
                ++ swipe
            )
            -- Keyed by image so each card replays its entrance animation.
            (( "image:" ++ c.src, image )
                :: List.indexedMap (\i n -> ( "nav" ++ String.fromInt i, n )) nav
                ++ [ ( "row"
                     , div [ class "row", stop Ignore ]
                        (position
                            ++ [ a [ class "button", href c.link.href, target "_blank", rel "noreferrer" ] [ text c.link.label ]
                               , button [ Html.Events.onClick Close ] [ text "Close" ]
                               ]
                        )
                     )
                   , ( "lock", node "mtg-scroll-lock" [] [] )
                   ]
                ++ List.map (\n -> ( "preload", n )) neighbours
            )
        )
