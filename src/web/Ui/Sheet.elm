module Ui.Sheet exposing
    ( Config
    , Dir
    , Drag
    , Model
    , Msg
    , gallery
    , onKey
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


type alias Model =
    { config : Config
    , items : Maybe ( List Item, Int )
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


init : Config -> Maybe ( List Item, Int ) -> Model
init config items =
    { config = config, items = items, dx = 0, enter = Nothing, drag = Nothing, swallowClick = False }


open : Config -> Model
open config =
    init config Nothing


gallery : List Item -> Int -> Model
gallery items at =
    init (itemConfig items at) (Just ( items, at ))


itemConfig : List Item -> Int -> Config
itemConfig items at =
    let
        item =
            List.drop at items |> List.head |> Maybe.withDefault { name = "", image = "", href = "" }
    in
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
                                    (mx < 0 && not (hasNext model)) || (mx > 0 && not (hasPrev model))
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


hasNext : Model -> Bool
hasNext model =
    case model.items of
        Just ( items, at ) ->
            at < List.length items - 1

        Nothing ->
            False


hasPrev : Model -> Bool
hasPrev model =
    case model.items of
        Just ( _, at ) ->
            at > 0

        Nothing ->
            False


go : Dir -> Model -> Model
go dir model =
    case model.items of
        Just ( items, at ) ->
            if (dir == Next && hasNext model) || (dir == Prev && hasPrev model) then
                let
                    next =
                        case dir of
                            Next ->
                                at + 1

                            Prev ->
                                at - 1
                in
                { model | enter = Just dir, items = Just ( items, next ), config = itemConfig items next }

            else
                model

        Nothing ->
            model


{-| Escape closes the sheet; the arrow keys move through a gallery.
-}
onKey : String -> Maybe Msg
onKey key =
    case key of
        "Escape" ->
            Just Close

        "ArrowRight" ->
            Just (Go Next)

        "ArrowLeft" ->
            Just (Go Prev)

        _ ->
            Nothing


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
            model.config

        isGallery =
            model.items /= Nothing

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
                    , disabled (not (hasPrev model))
                    , stop (Go Prev)
                    ]
                    [ text "‹" ]
                , button
                    [ class "sheet-nav next"
                    , attribute "aria-label" "Next card"
                    , disabled (not (hasNext model))
                    , stop (Go Next)
                    ]
                    [ text "›" ]
                ]

            else
                []

        position =
            case model.items of
                Just ( items, at ) ->
                    [ span [ class "sheet-position" ]
                        [ text (String.fromInt (at + 1) ++ " / " ++ String.fromInt (List.length items)) ]
                    ]

                Nothing ->
                    []

        neighbours =
            case model.items of
                Just ( items, at ) ->
                    -- Warm the neighbours so a swipe lands on a loaded image.
                    [ node "mtg-preload"
                        [ attribute "srcs"
                            (items
                                |> List.indexedMap Tuple.pair
                                |> List.filter (\( i, _ ) -> i == at - 1 || i == at + 1)
                                |> List.map (Tuple.second >> .image)
                                |> String.join " "
                            )
                        ]
                        []
                    ]

                Nothing ->
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
