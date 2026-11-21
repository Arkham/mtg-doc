module Page.Report exposing (ApplierState, Chrome, ComboFilter, DecklistView, Model, Msg, Out(..), chrome, closeHowToPlay, init, load, subscriptions, update, view)

import Api
import Chat
import Collate
import Combos
import Dict
import Env exposing (Env)
import Format exposing (money, toFixed)
import HowToPlay
import Html exposing (Html, a, article, button, dd, details, div, dl, dt, figcaption, figure, h1, h2, h3, header, img, input, label, li, nav, node, option, p, pre, section, select, span, strong, summary, table, tbody, td, text, th, thead, tr, ul)
import Html.Attributes exposing (attribute, checked, disabled, selected, style, value)
import Html.Events exposing (on, onCheck, onClick, onInput, preventDefaultOn)
import Html.Keyed as Keyed
import Json.Decode as D
import Json.Encode
import List.Extra
import Process
import Route exposing (DeckView(..))
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, href, id, placeholder, rel, src, target, title, type_)
import Ui.Bracket as Bracket
import Ui.Card as Card
import Ui.Mana as Mana
import Ui.Markdown as Markdown
import Ui.Sheet as Sheet
import Ui.Style exposing (ariaSelected, auraOfCards, cssVars)
import Url
import Views exposing (asOriginal, hasBothViews, viewOf)


pollMs : Float
pollMs =
    1000


type DecklistView
    = ListView
    | ImagesView


type ComboFilter
    = AllCombos
    | Present
    | Away


type Applier
    = SwapApplier
    | ManaApplier


type alias ApplierState =
    { busy : Maybe Swap, error : Maybe String }


type alias Model =
    { slug : String
    , detail : Maybe DeckDetail
    , error : Maybe String
    , pollToken : Int
    , copied : Bool
    , copyToken : Int
    , optimizedText : Maybe String
    , howToPlay : Bool
    , modalCount : Int
    , showSwaps : Bool
    , decklistView : DecklistView
    , comboFilter : ComboFilter
    , allCombos : Bool
    , synergiesBusy : Maybe String
    , synergiesError : Maybe String
    , swapApplier : ApplierState
    , manaApplier : ApplierState
    , manaBusy : Maybe String
    , manaError : Maybe String
    , target : Maybe Float
    , targetBusy : Bool
    , rerunOpen : Bool
    , rerunOpts : Maybe OptimizeOptions
    , publishBusy : Bool
    , exportCopied : Bool
    , exportClose : Int
    , active : Maybe String
    , chat : Chat.Model
    }


type Msg
    = GotDetail (Result String DeckDetail)
    | Poll Int
    | GotPolledDetail (Result String DeckDetail)
    | GotList (Maybe String)
    | Copied
    | Uncopy Int
    | OpenHowToPlay
    | CloseHowToPlay
    | ToggleSwaps
    | SetDecklistView DecklistView
    | SetComboFilter ComboFilter
    | ToggleAllCombos
    | RefreshSynergies String
    | GotSynergies (Result String Report)
    | ApplySwap Applier Swap
    | GotSwapEdit Applier (Result String String)
    | PollEdit Applier String
    | GotEdit Applier String (Result String EditStatus)
    | ApplyMana String
    | GotManaEdit (Result String String)
    | PollManaEdit String
    | GotManaEditStatus String (Result String EditStatus)
    | SetTarget Float
    | RunTarget Float
    | OpenRerun
    | SetRerun OptimizeOptions
    | RunRerun OptimizeOptions
    | Started (Result String ( String, String ))
    | TogglePublish Bool
    | GotPublish (Result String DeckDetailMeta)
    | ExportCopied
    | ExportDone
    | Activate String
    | ZoomCommander Card
    | ScrollToBracket
    | ChatMsg Chat.Msg
    | CardMsg Card.Msg
    | NavigateTo String
    | Ignore


type Out
    = Navigate String
    | OpenSheet Sheet.Model
    | Preview Card.Msg
    | SaveDecklistView String
    | ScrollTo String


init : Env -> String -> String -> ( Model, Cmd Msg )
init env decklistView slug =
    load env
        slug
        { slug = slug
        , detail = Nothing
        , error = Nothing
        , pollToken = 0
        , copied = False
        , copyToken = 0
        , optimizedText = Nothing
        , howToPlay = False
        , modalCount = 0
        , showSwaps = False
        , decklistView =
            if decklistView == "images" then
                ImagesView

            else
                ListView
        , comboFilter = AllCombos
        , allCombos = False
        , synergiesBusy = Nothing
        , synergiesError = Nothing
        , swapApplier = { busy = Nothing, error = Nothing }
        , manaApplier = { busy = Nothing, error = Nothing }
        , manaBusy = Nothing
        , manaError = Nothing
        , target = Nothing
        , targetBusy = False
        , rerunOpen = False
        , rerunOpts = Nothing
        , publishBusy = False
        , exportCopied = False
        , exportClose = 0
        , active = Nothing
        , chat = Chat.init
        }


{-| Loads a deck into the page, keeping everything else as it was (the page stays the same
between decks, like the old UI did).
-}
load : Env -> String -> Model -> ( Model, Cmd Msg )
load env slug model =
    ( { model | slug = slug }
    , Cmd.batch
        [ Api.deck env.isStatic slug GotDetail
        , loadList env slug
        , if model.slug /= slug then
            Cmd.map ChatMsg (Chat.slugChanged slug model.chat)

          else
            Cmd.none
        ]
    )


{-| Prefetched so the clipboard write happens synchronously in the tap; iOS Safari rejects it
otherwise.
-}
loadList : Env -> String -> Cmd Msg
loadList env slug =
    Api.fileText env.isStatic slug "optimized.txt" GotList


{-| After a change: show its report if there is one, and reload (edits rewrite the lists).
-}
applied : Env -> Maybe Report -> Model -> ( Model, Cmd Msg )
applied env report model =
    ( case report of
        Just r ->
            withReport r model

        Nothing ->
            model
    , Cmd.batch [ Api.deck env.isStatic model.slug GotDetail, loadList env model.slug ]
    )


withReport : Report -> Model -> Model
withReport r model =
    { model | detail = Maybe.map (\d -> { d | report = Just r }) model.detail }


none : Model -> ( Model, Cmd Msg, Maybe Out )
none model =
    ( model, Cmd.none, Nothing )


plain : ( Model, Cmd Msg ) -> ( Model, Cmd Msg, Maybe Out )
plain ( m, c ) =
    ( m, c, Nothing )


update : Env -> Msg -> Model -> ( Model, Cmd Msg, Maybe Out )
update env msg model =
    case msg of
        GotDetail (Ok detail) ->
            let
                token =
                    model.pollToken + 1

                updating =
                    detail.updating == Just True
            in
            ( { model | detail = Just detail, pollToken = token }
            , if updating then
                Process.sleep pollMs |> Task.perform (\_ -> Poll token)

              else
                Cmd.none
            , Nothing
            )

        GotDetail (Err e) ->
            if model.detail == Nothing then
                none { model | error = Just e }

            else
                none model

        Poll token ->
            if token == model.pollToken then
                ( model, Api.deck env.isStatic model.slug GotPolledDetail, Nothing )

            else
                none model

        GotPolledDetail result ->
            let
                ( m, cmd, out ) =
                    update env (GotDetail result) model
            in
            case result of
                Ok d ->
                    if d.updating == Just True then
                        ( m, cmd, out )

                    else
                        ( m, Cmd.batch [ cmd, loadList env model.slug ], out )

                Err _ ->
                    ( m, cmd, out )

        GotList text ->
            none { model | optimizedText = text }

        Copied ->
            let
                token =
                    model.copyToken + 1
            in
            ( { model | copied = True, copyToken = token }
            , Process.sleep 1500 |> Task.perform (\_ -> Uncopy token)
            , Nothing
            )

        Uncopy token ->
            if token == model.copyToken then
                none { model | copied = False }

            else
                none model

        OpenHowToPlay ->
            none { model | howToPlay = True }

        CloseHowToPlay ->
            none { model | howToPlay = False, modalCount = model.modalCount + 1 }

        ToggleSwaps ->
            none { model | showSwaps = not model.showSwaps }

        SetDecklistView v ->
            ( { model | decklistView = v }
            , Cmd.none
            , Just
                (SaveDecklistView
                    (if v == ImagesView then
                        "images"

                     else
                        "list"
                    )
                )
            )

        SetComboFilter f ->
            none { model | comboFilter = f }

        ToggleAllCombos ->
            none { model | allCombos = not model.allCombos }

        RefreshSynergies mode ->
            ( { model | synergiesBusy = Just mode, synergiesError = Nothing }
            , Api.refreshSynergies model.slug mode GotSynergies
            , Nothing
            )

        GotSynergies (Ok r) ->
            none (withReport r { model | synergiesBusy = Nothing })

        GotSynergies (Err e) ->
            none { model | synergiesBusy = Nothing, synergiesError = Just e }

        ApplySwap which swap ->
            ( setApplier which { busy = Just swap, error = Nothing } model
            , Api.applySwap model.slug swap (GotSwapEdit which)
            , Nothing
            )

        GotSwapEdit which (Ok id) ->
            let
                ( m, cmd ) =
                    applied env Nothing model
            in
            ( m, Cmd.batch [ cmd, Api.edit id (GotEdit which id) ], Nothing )

        GotSwapEdit which (Err e) ->
            none (setApplier which { busy = Nothing, error = Just e } model)

        PollEdit which id ->
            ( model, Api.edit id (GotEdit which id), Nothing )

        GotEdit which id (Ok status) ->
            case status.state of
                EditStatusStateDone ->
                    plain (applied env Nothing (setApplier which { busy = Nothing, error = (applierOf which model).error } model))

                EditStatusStateFailed ->
                    none (setApplier which { busy = Nothing, error = Just (Maybe.withDefault "That change failed." status.error) } model)

                _ ->
                    ( model, Process.sleep pollMs |> Task.perform (\_ -> PollEdit which id), Nothing )

        GotEdit which _ (Err e) ->
            none (setApplier which { busy = Nothing, error = Just e } model)

        ApplyMana id ->
            ( { model | manaBusy = Just id, manaError = Nothing }
            , Api.applyManaSuggestion model.slug id GotManaEdit
            , Nothing
            )

        GotManaEdit (Ok id) ->
            let
                ( m, cmd ) =
                    applied env Nothing model
            in
            ( m, Cmd.batch [ cmd, Api.edit id (GotManaEditStatus id) ], Nothing )

        GotManaEdit (Err e) ->
            none { model | manaBusy = Nothing, manaError = Just e }

        PollManaEdit id ->
            ( model, Api.edit id (GotManaEditStatus id), Nothing )

        GotManaEditStatus id (Ok status) ->
            case status.state of
                EditStatusStateDone ->
                    plain (applied env Nothing { model | manaBusy = Nothing })

                EditStatusStateFailed ->
                    none { model | manaBusy = Nothing, manaError = Just (Maybe.withDefault "That change failed." status.error) }

                _ ->
                    ( model, Process.sleep pollMs |> Task.perform (\_ -> PollManaEdit id), Nothing )

        GotManaEditStatus _ (Err e) ->
            none { model | manaBusy = Nothing, manaError = Just e }

        SetTarget t ->
            none { model | target = Just t }

        RunTarget t ->
            case model.detail |> Maybe.andThen .report of
                Just r ->
                    let
                        o =
                            r.options
                    in
                    ( { model | targetBusy = True }
                    , Api.reoptimize model.slug { o | bracket = Just t } Started
                    , Nothing
                    )

                Nothing ->
                    none model

        OpenRerun ->
            none { model | rerunOpen = True }

        SetRerun o ->
            none { model | rerunOpts = Just o }

        RunRerun o ->
            ( model, Api.reoptimize model.slug o Started, Nothing )

        Started (Ok ( slug, jobId )) ->
            ( model, Cmd.none, Just (Navigate (Route.href env.isStatic (Route.Job slug jobId))) )

        Started (Err _) ->
            none { model | targetBusy = False }

        TogglePublish suggestions ->
            ( { model | publishBusy = True }, Api.setPublishing model.slug suggestions GotPublish, Nothing )

        GotPublish (Ok meta) ->
            none { model | publishBusy = False, detail = Maybe.map (\d -> { d | meta = meta }) model.detail }

        GotPublish (Err _) ->
            none { model | publishBusy = False }

        ExportCopied ->
            ( { model | exportCopied = True }, Process.sleep 1000 |> Task.perform (\_ -> ExportDone), Nothing )

        ExportDone ->
            none { model | exportCopied = False, exportClose = model.exportClose + 1 }

        Activate id ->
            none { model | active = Just id }

        ZoomCommander c ->
            case c.image of
                Just image ->
                    ( model
                    , Cmd.none
                    , Just
                        (OpenSheet
                            (Sheet.open
                                { src = image
                                , alt = c.name
                                , link = { href = c.scryfallUri, label = "Scryfall ↗" }
                                , wide = False
                                , foil = Just (auraOfCards (model.detail |> Maybe.andThen .report |> Maybe.map .commanderCards |> Maybe.withDefault []))
                                }
                            )
                        )
                    )

                Nothing ->
                    none model

        ScrollToBracket ->
            ( model, Cmd.none, Just (ScrollTo "bracket") )

        ChatMsg m ->
            let
                ( chat, cmd, out ) =
                    Chat.update env model.slug m model.chat

                next =
                    { model | chat = chat }

                mapped =
                    Cmd.map ChatMsg cmd
            in
            case out of
                Just (Chat.Applied report) ->
                    let
                        ( m2, c2 ) =
                            applied env report next
                    in
                    ( m2, Cmd.batch [ mapped, c2 ], Nothing )

                Just (Chat.Go href) ->
                    ( next, mapped, Just (Navigate href) )

                Just (Chat.CardPreview cm) ->
                    ( next, mapped, Just (Preview cm) )

                Nothing ->
                    ( next, mapped, Nothing )

        CardMsg m ->
            ( model, Cmd.none, Just (Preview m) )

        NavigateTo href ->
            ( model, Cmd.none, Just (Navigate href) )

        Ignore ->
            none model


applierOf : Applier -> Model -> ApplierState
applierOf which model =
    case which of
        SwapApplier ->
            model.swapApplier

        ManaApplier ->
            model.manaApplier


setApplier : Applier -> ApplierState -> Model -> Model
setApplier which state model =
    case which of
        SwapApplier ->
            { model | swapApplier = state }

        ManaApplier ->
            { model | manaApplier = state }


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.map ChatMsg (Chat.subscriptions model.chat)



-- VIEWS OF THE REPORT


interaction : DeckSnapshot -> Float
interaction snap =
    snap.roles
        |> List.filter (\r -> r.role == RoleRemoval || r.role == RoleCounter || r.role == RoleWipe)
        |> List.map .count
        |> List.sum


muted : String -> Html msg
muted t =
    span [ class "muted" ] [ text t ]


spinner : Html msg
spinner =
    span [ class "spinner", attribute "aria-hidden" "true" ] []


maybeHtml : Maybe a -> (a -> Html msg) -> Html msg
maybeHtml m f =
    case m of
        Just v ->
            f v

        Nothing ->
            text ""


when : Bool -> Html msg -> Html msg
when cond html =
    if cond then
        html

    else
        text ""


delta : { before : Float, after : Float, unit : String, higherIsBetter : Bool, digits : Int } -> Html msg
delta o =
    let
        d =
            o.after - o.before
    in
    if abs d < 10 ^ toFloat -o.digits / 2 then
        muted "±0"

    else
        let
            good =
                if o.higherIsBetter then
                    d > 0

                else
                    d < 0
        in
        span
            [ class
                (if good then
                    "ok"

                 else
                    "warn"
                )
            ]
            [ text
                ((if d > 0 then
                    "+"

                  else
                    ""
                 )
                    ++ toFixed o.digits d
                    ++ o.unit
                )
            ]


cardLike : Card -> Card.CardLike
cardLike c =
    { image = c.image, scryfallUri = c.scryfallUri }


miniCard : Env -> Card.Ctx msg -> Maybe Card -> String -> String -> Html msg
miniCard env ctx card cardName side =
    div [ class ("mini-card " ++ side) ]
        [ case card |> Maybe.andThen .image |> Maybe.andThen nonEmpty of
            Just image ->
                Card.nameWith ctx
                    { name = cardName
                    , card = Maybe.map cardLike card
                    , label = Just [ img [ src image, alt cardName, attribute "loading" "lazy" ] [] ]
                    , class = Just "mini-card-img"
                    , key = Nothing
                    }

            Nothing ->
                div [ class "placeholder" ] [ text "🃏" ]
        , div [ class "mini-card-text" ]
            [ span [ class "side-label" ]
                [ text
                    (if side == "out" then
                        "Cut"

                     else
                        "Add"
                    )
                ]
            , Card.nameWith ctx { name = cardName, card = Maybe.map cardLike card, label = Nothing, class = Just "mini-card-name", key = Nothing }
            , div [ class "muted small mini-card-meta" ]
                [ Mana.cost env.base 13 (Maybe.map .manaCost card)
                , span []
                    [ text
                        (case card |> Maybe.andThen .priceUsd of
                            Just price ->
                                money (Just price)

                            Nothing ->
                                ""
                        )
                    ]
                ]
            ]
        ]


nonEmpty : String -> Maybe String
nonEmpty s =
    if s == "" then
        Nothing

    else
        Just s


{-| Section title with an optional one-line description and actions on the right.
-}
panelHead : { title : String, desc : Maybe (List (Html msg)), actions : Maybe (List (Html msg)), compact : Bool } -> Html msg
panelHead o =
    header
        [ class
            ("panel-head"
                ++ (if o.compact then
                        " compact"

                    else
                        ""
                   )
            )
        ]
        (div [ class "panel-head-text" ]
            (h2 [] [ text o.title ]
                :: (case o.desc of
                        Just d ->
                            [ p [ class "panel-desc" ] d ]

                        Nothing ->
                            []
                   )
            )
            :: (case o.actions of
                    Just acts ->
                        [ div [ class "panel-actions" ] acts ]

                    Nothing ->
                        []
               )
        )


isManaSwap : Swap -> Bool
isManaSwap s =
    s.category == SwapCategoryMana || (Maybe.map .isLand s.inCard == Just True && Maybe.map .isLand s.outCard == Just True)


applyButton : Env -> Applier -> ApplierState -> Swap -> Html Msg
applyButton env which state swap =
    if env.isStatic then
        text ""

    else
        let
            busy =
                Maybe.map (\b -> b.out == swap.out && b.in_ == swap.in_) state.busy == Just True
        in
        button
            [ class "small-btn"
            , disabled (state.busy /= Nothing)
            , onClick (ApplySwap which swap)
            , attribute "aria-label" ("Apply " ++ swap.out ++ " → " ++ swap.in_ ++ " to your deck")
            , title "Make this swap in your deck as submitted"
            ]
            [ if busy then
                spinner

              else
                text "Apply"
            ]


categoryLabel : Swap -> String
categoryLabel s =
    if s.fromChat == Just True then
        "💬 Chat edit"

    else
        let
            name =
                swapCategoryToString s.category

            emoji =
                case s.category of
                    SwapCategoryBracket ->
                        "🎯"

                    SwapCategorySynergy ->
                        "🧩"

                    SwapCategoryCombo ->
                        "♾️"

                    SwapCategoryMana ->
                        "💧"

                    SwapCategoryRamp ->
                        "🌱"

                    SwapCategoryDraw ->
                        "📚"

                    SwapCategoryInteraction ->
                        "🛡️"

                    SwapCategoryCurve ->
                        "📉"

                    SwapCategoryOther ->
                        "✨"
        in
        emoji ++ " " ++ String.toUpper (String.left 1 name) ++ String.dropLeft 1 name


swapGroup : Env -> Card.Ctx Msg -> ApplierState -> String -> List Swap -> Html Msg
swapGroup env ctx state title swaps =
    if List.isEmpty swaps then
        text ""

    else
        div [ class "swap-group" ]
            [ h3 [] [ text (title ++ " "), muted ("· " ++ String.fromInt (List.length swaps)) ]
            , div [ class "swaps" ]
                (List.map
                    (\s ->
                        article [ class "swap" ]
                            [ div [ class "swap-head" ]
                                [ span [ class "badge" ] [ text (categoryLabel s) ]
                                , applyButton env SwapApplier state s
                                ]
                            , div [ class "swap-cards" ]
                                [ miniCard env ctx s.outCard s.out "out"
                                , div [ class "arrow", attribute "aria-hidden" "true" ] [ text "→" ]
                                , miniCard env ctx s.inCard s.in_ "in"
                                ]
                            , div [ class "reason" ]
                                (p [] (Card.prose ctx s.reason)
                                    :: (case s.alternatives of
                                            Just ((_ :: _) as alts) ->
                                                [ p [ class "alternatives small" ]
                                                    (muted "Also consider: "
                                                        :: List.indexedMap
                                                            (\j alt_ ->
                                                                span []
                                                                    ((if j > 0 then
                                                                        [ muted " · " ]

                                                                      else
                                                                        []
                                                                     )
                                                                        ++ [ Card.nameWith ctx { name = alt_.name, card = Just { image = alt_.image, scryfallUri = alt_.scryfallUri }, label = Nothing, class = Nothing, key = Nothing } ]
                                                                    )
                                                            )
                                                            alts
                                                    )
                                                ]

                                            _ ->
                                                []
                                       )
                                )
                            ]
                    )
                    swaps
                )
            ]


swapList : Env -> Card.Ctx Msg -> Model -> List Swap -> List (Html Msg)
swapList env ctx model swaps =
    if List.isEmpty swaps then
        [ p [ class "muted" ] [ text "No swaps suggested. The deck already looks tight." ] ]

    else
        [ swapGroup env ctx model.swapApplier "Spells" (List.filter (not << isManaSwap) swaps)
        , swapGroup env ctx model.swapApplier "Mana base" (List.filter isManaSwap swaps)
        , maybeHtml model.swapApplier.error (\e -> p [ class "error small" ] [ text e ])
        ]


colorWord : Color -> String
colorWord c =
    case c of
        ColorW ->
            "white"

        ColorU ->
            "blue"

        ColorB ->
            "black"

        ColorR ->
            "red"

        ColorG ->
            "green"


colorName : Color -> String
colorName c =
    case c of
        ColorW ->
            "White"

        ColorU ->
            "Blue"

        ColorB ->
            "Black"

        ColorR ->
            "Red"

        ColorG ->
            "Green"


pct : Float -> Float -> String
pct n max =
    String.fromFloat ((n / max) * 100) ++ "%"


colorBars : Env -> Card.Ctx msg -> DeckSnapshot -> DeckSnapshot -> Html msg
colorBars env ctx before after =
    let
        max =
            List.maximum
                (List.map (\c -> Basics.max c.targetSources c.landSources) after.mana.colors
                    ++ List.map .landSources before.mana.colors
                    ++ [ 1 ]
                )
                |> Maybe.withDefault 1

        beforeOf c =
            List.Extra.find (\x -> x.color == c.color) before.mana.colors

        changed =
            List.any (\c -> Maybe.map .landSources (beforeOf c) /= Just c.landSources) after.mana.colors
    in
    div [ class "color-bars" ]
        (List.map
            (\c ->
                let
                    b =
                        beforeOf c

                    gap =
                        c.targetSources - c.landSources

                    word =
                        colorWord c.color
                in
                div [ class "color-row" ]
                    [ span [ title (colorName c.color) ] [ Mana.cost env.base 22 (Just ("{" ++ colorToString c.color ++ "}")) ]
                    , div [ class "color-row-head" ]
                        [ span []
                            [ strong [] [ text (String.fromFloat c.landSources) ]
                            , text " of the "
                            , strong [] [ text (String.fromFloat c.targetSources) ]
                            , text (" lands we'd want make " ++ word)
                            , case b of
                                Just bb ->
                                    when (changed && bb.landSources /= c.landSources) (muted (" (was " ++ String.fromFloat bb.landSources ++ ")"))

                                Nothing ->
                                    text ""
                            ]
                        , span
                            [ class
                                ("status-chip "
                                    ++ (if gap > 1 then
                                            "warn"

                                        else
                                            "ok"
                                       )
                                )
                            ]
                            [ text
                                (if gap > 0 then
                                    String.fromFloat gap ++ " short"

                                 else
                                    "enough"
                                )
                            ]
                        ]
                    , div [ class "bar-track" ]
                        [ when changed (div [ class "bar before", style "width" (pct (b |> Maybe.map .landSources |> Maybe.withDefault 0) max) ] [])
                        , div
                            [ class
                                ("bar after "
                                    ++ (if changed then
                                            ""

                                        else
                                            "solo"
                                       )
                                )
                            , style "width" (pct c.landSources max)
                            ]
                            []
                        , div [ class "target", style "left" (pct c.targetSources max), title ("target " ++ String.fromFloat c.targetSources) ] []
                        ]
                    , span [ class "small color-why" ]
                        (text (String.fromInt (round (c.pipShare * 100)) ++ "% of the colored mana symbols in your spells are " ++ word ++ ". ")
                            :: (case ( c.targetReason, c.heaviestCard ) of
                                    ( Just ColorStatTargetReasonHeaviestCard, Just heaviest ) ->
                                        [ text "The target is higher because "
                                        , Card.name ctx heaviest.name
                                        , text " costs "
                                        , Mana.cost env.base 13 (Just heaviest.manaCost)
                                        , text "."
                                        ]

                                    _ ->
                                        []
                               )
                            ++ [ text
                                    (if c.rampSources /= 0 then
                                        " Your mana rocks and creatures add " ++ String.fromFloat c.rampSources ++ " more " ++ word ++ " sources."

                                     else
                                        ""
                                    )
                               ]
                        )
                    ]
            )
            after.mana.colors
            ++ [ div [ class "muted small legend" ]
                    ((if changed then
                        [ span [ class "bar-swatch before" ] []
                        , text " before "
                        , span [ class "bar-swatch after" ] []
                        , text " after"
                        ]

                      else
                        []
                     )
                        ++ [ span [ class "target-swatch" ] [], text " lands we'd want" ]
                    )
               ]
        )


synergies : Env -> Card.Ctx Msg -> Model -> Report -> Bool -> List (Html Msg)
synergies env ctx model r canRefresh =
    let
        items =
            Maybe.withDefault [] r.synergies

        image n =
            case Dict.get n (Maybe.withDefault Dict.empty r.cardIndex) |> Maybe.andThen .image of
                Just i ->
                    Just i

                Nothing ->
                    r.decklist |> Maybe.withDefault [] |> List.Extra.find (\c -> c.name == n) |> Maybe.andThen .image

        busy =
            model.synergiesBusy /= Nothing

        refresh mode label =
            button [ class "small-btn", disabled busy, onClick (RefreshSynergies mode) ]
                ((if model.synergiesBusy == Just mode then
                    [ spinner ]

                  else
                    []
                 )
                    ++ [ text label ]
                )
    in
    [ panelHead
        { title = "Synergies"
        , desc = Just [ text "Cards that are stronger together, without being an infinite combo." ]
        , actions =
            if not env.isStatic && canRefresh then
                Just
                    ((if List.isEmpty items then
                        []

                      else
                        [ refresh "more" "Find more" ]
                     )
                        ++ [ refresh "again"
                                (if List.isEmpty items then
                                    "Find synergies"

                                 else
                                    "Find again"
                                )
                           ]
                    )

            else
                Nothing
        , compact = False
        }
    , maybeHtml model.synergiesError (\e -> p [ class "error small" ] [ text e ])
    , if List.isEmpty items then
        p [ class "muted" ] [ text "No synergies yet." ]

      else
        ul [ class "synergies" ]
            (List.map
                (\syn ->
                    li [ class "synergy" ]
                        [ div [ class "synergy-cards" ]
                            (List.map
                                (\n ->
                                    case image n of
                                        Just i ->
                                            Card.nameWith ctx
                                                { name = n
                                                , card = Nothing
                                                , label = Just [ img [ class "card-thumb", src i, alt n, attribute "loading" "lazy" ] [] ]
                                                , class = Nothing
                                                , key = Nothing
                                                }

                                        Nothing ->
                                            text ""
                                )
                                syn.cards
                            )
                        , div [ class "synergy-text" ]
                            [ strong [] [ text syn.title ]
                            , div [ class "small synergy-names" ] (Card.list ctx " + " syn.cards)
                            , p [ class "small" ] (Card.prose ctx syn.explanation)
                            ]
                        ]
                )
                items
            )
    ]


manaAdvice : Env -> Card.Ctx Msg -> Model -> Report -> Html Msg
manaAdvice env ctx model r =
    let
        changed =
            List.filter
                (\s -> s.category == SwapCategoryMana && Maybe.map .isLand s.inCard == Just True && Maybe.map .isLand s.outCard == Just True)
                r.swaps

        suggestions =
            Maybe.withDefault [] r.manaSuggestions
    in
    div [ class "mana-advice" ]
        ((if List.isEmpty changed then
            []

          else
            [ h3 [] [ text "What we changed" ]
            , ul [ class "mana-changes" ]
                (List.map
                    (\s ->
                        li []
                            [ div [ class "mana-swap" ]
                                [ span [ class "mana-swap-chips" ]
                                    [ span [ class "edit-chip remove" ]
                                        [ text "− ", Card.nameWith ctx { name = s.out, card = Maybe.map cardLike s.outCard, label = Nothing, class = Nothing, key = Nothing } ]
                                    , muted "→"
                                    , span [ class "edit-chip add" ]
                                        [ text "+ ", Card.nameWith ctx { name = s.in_, card = Maybe.map cardLike s.inCard, label = Nothing, class = Nothing, key = Nothing } ]
                                    ]
                                , applyButton env ManaApplier model.manaApplier s
                                ]
                            , div [ class "muted small" ] (Card.prose ctx s.reason)
                            ]
                    )
                    changed
                )
            , maybeHtml model.manaApplier.error (\e -> p [ class "error small" ] [ text e ])
            ]
         )
            ++ (if List.isEmpty suggestions then
                    []

                else
                    [ h3 [] [ text "Suggested swaps" ]
                    , ul [ class "mana-changes" ]
                        (List.map
                            (\m ->
                                li []
                                    [ div [ class "mana-swap" ]
                                        [ span [ class "mana-swap-chips" ]
                                            (List.map
                                                (\c ->
                                                    span [ class ("edit-chip " ++ deckChangeActionToString c.action) ]
                                                        ([ text
                                                            (if c.action == DeckChangeActionAdd then
                                                                "+ "

                                                             else
                                                                "− "
                                                            )
                                                         , Card.nameWith ctx { name = c.name, card = Maybe.map cardLike c.card, label = Nothing, class = Nothing, key = Nothing }
                                                         ]
                                                            ++ (case ( c.action, c.card |> Maybe.andThen .priceUsd ) of
                                                                    ( DeckChangeActionAdd, Just price ) ->
                                                                        [ span [ class "muted small" ] [ text (" $" ++ toFixed 2 price) ] ]

                                                                    _ ->
                                                                        []
                                                               )
                                                        )
                                                )
                                                m.changes
                                            )
                                        , when (not env.isStatic)
                                            (button
                                                [ class "small-btn"
                                                , disabled (model.manaBusy /= Nothing)
                                                , onClick (ApplyMana m.id)
                                                , title "Make this swap in your deck as submitted"
                                                ]
                                                [ if model.manaBusy == Just m.id then
                                                    spinner

                                                  else
                                                    text "Apply"
                                                ]
                                            )
                                        ]
                                    , div [ class "muted small" ] (Card.prose ctx m.reason)
                                    ]
                            )
                            suggestions
                        )
                    , maybeHtml model.manaError (\e -> p [ class "error small" ] [ text e ])
                    ]
               )
            ++ (if List.isEmpty r.after.mana.issues then
                    []

                else
                    [ h3 [] [ text "Still worth a look" ]
                    , ul [ class "notes" ] (List.map (\n -> li [] [ text n ]) r.after.mana.issues)
                    ]
               )
        )


curve : Bool -> DeckSnapshot -> DeckSnapshot -> Html msg
curve single before after =
    let
        keys =
            [ "0", "1", "2", "3", "4", "5", "6", "7+" ]

        at snap k =
            Dict.get k snap.mana.curve |> Maybe.withDefault 0

        -- Headroom above the tallest bar for its count label.
        max =
            (List.maximum (List.map (\k -> Basics.max (at before k) (at after k)) keys ++ [ 1 ]) |> Maybe.withDefault 1) * 1.18
    in
    figure [ class "curve-figure" ]
        [ div [ class "curve", attribute "role" "img", attribute "aria-label" "Mana curve, before and after" ]
            (List.map
                (\k ->
                    let
                        was =
                            at before k

                        now =
                            at after k
                    in
                    div [ class "curve-col" ]
                        [ div [ class "curve-bars" ]
                            [ span
                                (class "curve-count"
                                    :: style "bottom" (pct (Basics.max was now) max)
                                    :: (if was /= now then
                                            [ title ("was " ++ String.fromFloat was) ]

                                        else
                                            []
                                       )
                                )
                                [ text (String.fromFloat now) ]
                            , when (not single) (div [ class "bar before", style "height" (pct was max), title ("before: " ++ String.fromFloat was) ] [])
                            , div [ class "bar after", style "height" (pct now max), title ("after: " ++ String.fromFloat now) ] []
                            ]
                        , span [ class "curve-mv" ] [ text k ]
                        ]
                )
                keys
            )
        , figcaption [ class "legend" ]
            ((if single then
                []

              else
                [ span [ class "bar-swatch before" ] []
                , text " before "
                , span [ class "bar-swatch after" ] []
                , text " after"
                ]
             )
                ++ [ span [ class "grow" ] [], text "mana value" ]
            )
        ]


simTable : Bool -> DeckSnapshot -> DeckSnapshot -> Html msg
simTable single before after =
    let
        b =
            before.sim

        a =
            after.sim

        turn d t =
            Dict.get (String.fromInt t) d |> Maybe.withDefault 0

        rows =
            ( "Mulligan rate", ( b.mulliganRate, a.mulliganRate ), ( False, "%" ) )
                :: List.map
                    (\t -> ( "Land drop on turn " ++ String.fromInt t, ( turn b.landDropByTurn t, turn a.landDropByTurn t ), ( True, "%" ) ))
                    [ 2, 3, 4, 5 ]
                ++ [ ( "Commander cast on curve", ( b.commanderOnCurve, a.commanderOnCurve ), ( True, "%" ) )
                   , ( "Commander cast by turn 5", ( turn b.commanderByTurn 5, turn a.commanderByTurn 5 ), ( True, "%" ) )
                   , ( "All colors by turn 3", ( b.allColorsByTurn3, a.allColorsByTurn3 ), ( True, "%" ) )
                   , ( "Mana available turn 4", ( b.avgManaTurn4, a.avgManaTurn4 ), ( True, "" ) )
                   , ( "Mana screw (<3 lands on T4)", ( b.screwRate, a.screwRate ), ( False, "%" ) )
                   , ( "Flood (10+ lands seen by T7)", ( b.floodRate, a.floodRate ), ( False, "%" ) )
                   ]
    in
    if single then
        table [ class "data" ]
            [ tbody []
                (List.map
                    (\( label, ( _, y ), ( _, unit ) ) ->
                        tr [] [ td [] [ text label ], td [] [ strong [] [ text (String.fromFloat y ++ unit) ] ] ]
                    )
                    rows
                )
            ]

    else
        table [ class "data" ]
            [ thead [] [ tr [] [ th [] [], th [] [ text "Before" ], th [] [ text "After" ], th [] [ text "Δ" ] ] ]
            , tbody []
                (List.map
                    (\( label, ( x, y ), ( hib, unit ) ) ->
                        tr []
                            [ td [] [ text label ]
                            , td [] [ text (String.fromFloat x ++ unit) ]
                            , td [] [ strong [] [ text (String.fromFloat y ++ unit) ] ]
                            , td []
                                [ delta
                                    { before = x
                                    , after = y
                                    , unit = unit
                                    , higherIsBetter = hib
                                    , digits =
                                        if unit /= "" then
                                            1

                                        else
                                            2
                                    }
                                ]
                            ]
                    )
                    rows
                )
            ]


roles : Bool -> DeckSnapshot -> DeckSnapshot -> Html msg
roles single before after =
    table [ class "data" ]
        [ thead []
            [ tr []
                (th [] [ text "Role" ]
                    :: (if single then
                            []

                        else
                            [ th [] [ text "Before" ] ]
                       )
                    ++ [ th []
                            [ text
                                (if single then
                                    "Cards"

                                 else
                                    "After"
                                )
                            ]
                       , th [] [ text "Typical" ]
                       ]
                )
            ]
        , tbody []
            (after.roles
                |> List.filter (\r -> r.role /= RoleOther && r.role /= RoleLand)
                |> List.map
                    (\r ->
                        let
                            short =
                                case r.target of
                                    Just t ->
                                        r.count < t

                                    Nothing ->
                                        False
                        in
                        Keyed.node "tr"
                            []
                            (( "role", td [] [ text (roleToString r.role) ] )
                                :: (if single then
                                        []

                                    else
                                        let
                                            b =
                                                List.Extra.find (\x -> x.role == r.role) before.roles |> Maybe.map .count |> Maybe.withDefault 0
                                        in
                                        [ ( "before", td [] [ text (String.fromFloat b) ] ) ]
                                   )
                                ++ List.map2 Tuple.pair
                                    [ "count", "typical" ]
                                    [ td
                                        [ class
                                            (if short then
                                                "warn"

                                             else
                                                ""
                                            )
                                        ]
                                        [ strong [] [ text (String.fromFloat r.count) ] ]
                                    , td [ class "muted" ]
                                        [ text
                                            (case r.target of
                                                Just t ->
                                                    if t /= 0 then
                                                        String.fromFloat t ++ "+"

                                                    else
                                                        ""

                                                Nothing ->
                                                    ""
                                            )
                                        ]
                                    ]
                            )
                    )
            )
        ]


{-| Pick another target bracket; the re-run only starts after an explicit second tap.
-}
targetBracket : Model -> Float -> Html Msg
targetBracket model current =
    let
        target =
            Maybe.withDefault current model.target
    in
    div [ class "target-bracket" ]
        [ label []
            [ span [ class "muted small" ] [ text "Aim for" ]
            , select
                [ attribute "aria-label" "Target bracket"
                , on "change" (D.at [ "target", "value" ] D.string |> D.map (String.toFloat >> Maybe.withDefault 0 >> SetTarget))
                ]
                (List.map
                    (\n -> option [ Ui.Attr.optionValue (String.fromInt n), selected (toFloat n == target) ] [ text ("Bracket " ++ String.fromInt n) ])
                    [ 1, 2, 3, 4, 5 ]
                )
            ]
        , when (target /= current)
            (button [ class "primary", disabled model.targetBusy, onClick (RunTarget target) ]
                ((if model.targetBusy then
                    [ spinner ]

                  else
                    []
                 )
                    ++ [ text ("Re-run for bracket " ++ String.fromFloat target) ]
                )
            )
        ]


rerun : Model -> OptimizeOptions -> Html Msg
rerun model initial =
    if not model.rerunOpen then
        button [ onClick OpenRerun ] [ text "Re-run with different options" ]

    else
        let
            opts =
                Maybe.withDefault initial model.rerunOpts

            number s =
                String.toFloat s |> Maybe.withDefault 0

            optional s =
                if s == "" then
                    Nothing

                else
                    Just (number s)

            onValue toOpts =
                on "change" (D.at [ "target", "value" ] D.string |> D.map (toOpts >> SetRerun))

            orEmpty =
                Maybe.map String.fromFloat >> Maybe.withDefault ""
        in
        div [ class "rerun" ]
            [ label []
                [ text "Max swaps "
                , input
                    [ type_ "number"
                    , value (String.fromFloat opts.maxSwaps)
                    , Ui.Attr.valueAttr (String.fromFloat opts.maxSwaps)
                    , Ui.Attr.min "1"
                    , Ui.Attr.max "40"
                    , onInput (\v -> SetRerun { opts | maxSwaps = number v })
                    ]
                    []
                ]
            , label []
                [ text "Deck budget $ "
                , input [ type_ "number", placeholder "none", value (orEmpty opts.budgetTotal), Ui.Attr.valueAttr (orEmpty opts.budgetTotal), onInput (\v -> SetRerun { opts | budgetTotal = optional v }) ] []
                ]
            , label []
                [ text "Budget/card $ "
                , input [ type_ "number", placeholder "none", value (orEmpty opts.budgetPerCard), Ui.Attr.valueAttr (orEmpty opts.budgetPerCard), onInput (\v -> SetRerun { opts | budgetPerCard = optional v }) ] []
                ]
            , label []
                [ text "Bracket "
                , select [ onValue (\v -> { opts | bracket = optional v }) ]
                    (option [ Ui.Attr.optionValue "", selected (opts.bracket == Nothing) ] [ text "current" ]
                        :: List.map (\b -> option [ selected (opts.bracket == Just (toFloat b)) ] [ text (String.fromInt b) ]) [ 1, 2, 3, 4, 5 ]
                    )
                ]
            , label []
                [ text "Tone "
                , select [ onValue (\v -> { opts | tone = toneFromString v |> Maybe.withDefault ToneMax }) ]
                    (List.map
                        (\( t, l ) -> option [ Ui.Attr.optionValue (toneToString t), selected (opts.tone == t) ] [ text l ])
                        [ ( ToneMax, "max power" ), ( ToneBalanced, "balanced" ), ( ToneCasual, "casual" ) ]
                    )
                ]
            , label [ class "checkbox" ]
                [ input [ type_ "checkbox", checked opts.webResearch, onCheck (\c -> SetRerun { opts | webResearch = c }) ] []
                , text " web research"
                ]
            , button [ class "primary", onClick (RunRerun opts) ] [ text "Run" ]
            ]


groupOrder : List String
groupOrder =
    [ "Commander", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other" ]


hostOf : String -> String
hostOf url =
    case Url.fromString url of
        Just u ->
            let
                host =
                    String.toLower u.host
            in
            if String.startsWith "www." host then
                String.dropLeft 4 host

            else
                host

        Nothing ->
            ""


newBadge : DecklistCard -> String -> Html msg
newBadge c cls =
    if c.isNew then
        span [ class cls ] [ text "new" ]

    else if c.delta /= 0 then
        span [ class cls ]
            [ text
                (if c.delta > 0 then
                    "+" ++ String.fromFloat c.delta

                 else
                    "−" ++ String.fromFloat -c.delta
                )
            ]

    else
        text ""


{-| Deck list as a visual grid of card images, grouped by type; tap a card to see it full size.
-}
deckImages : Card.Ctx Msg -> List ( String, List DecklistCard ) -> Bool -> Html Msg
deckImages ctx groups showNew =
    let
        items =
            Maybe.withDefault [] ctx.gallery

        open cardName =
            case List.Extra.findIndex (\it -> it.name == cardName) items of
                Just i ->
                    CardMsg (Card.OpenGallery items i)

                Nothing ->
                    Ignore
    in
    div [ class "deck-images" ]
        (List.map
            (\( group, cards ) ->
                section []
                    [ h3 [] [ text (group ++ " "), muted ("(" ++ String.fromFloat (List.sum (List.map .qty cards)) ++ ")") ]
                    , ul []
                        (List.map
                            (\c ->
                                li
                                    [ class
                                        ("deck-image "
                                            ++ (if showNew && (c.isNew || c.delta > 0) then
                                                    "new"

                                                else
                                                    ""
                                               )
                                        )
                                    ]
                                    [ button
                                        [ attribute "aria-label" ("Show " ++ c.name ++ " full size")
                                        , onClick
                                            (if c.image /= Nothing then
                                                open c.name

                                             else
                                                Ignore
                                            )
                                        ]
                                        ([ case c.image of
                                            Just image ->
                                                img [ src image, alt c.name, attribute "loading" "lazy" ] []

                                            Nothing ->
                                                span [ class "deck-image-missing" ] [ text c.name ]
                                         , when (c.qty > 1) (span [ class "deck-image-qty" ] [ text ("×" ++ String.fromFloat c.qty) ])
                                         ]
                                            ++ (if not showNew then
                                                    []

                                                else if c.isNew then
                                                    [ span [ class "deck-image-new" ] [ span [ attribute "aria-hidden" "true" ] [ text "✦" ], text " new" ] ]

                                                else if c.delta /= 0 then
                                                    [ newBadge c "deck-image-new" ]

                                                else
                                                    []
                                               )
                                        )
                                    ]
                            )
                            cards
                        )
                    ]
            )
            groups
        )


{-| The deck's cards as a list or images and, on the optimized view, the swaps that made it.
-}
decklist : Env -> Card.Ctx Msg -> Model -> List DecklistCard -> Bool -> Maybe ( Int, List (Html Msg) ) -> List (Html Msg)
decklist env ctx model cards compare swaps =
    let
        swapsShown =
            swaps /= Nothing && model.showSwaps

        head =
            panelHead
                { title =
                    if swapsShown then
                        "Swaps"

                    else
                        "Decklist"
                , desc = Nothing
                , actions =
                    Maybe.map
                        (\( count, _ ) ->
                            [ button [ onClick ToggleSwaps ]
                                (if swapsShown then
                                    [ text "Show decklist" ]

                                 else
                                    [ text "Show swaps ", span [ class "count" ] [ text (String.fromInt count) ] ]
                                )
                            ]
                        )
                        swaps
                , compact = True
                }
    in
    case ( swapsShown, swaps ) of
        ( True, Just ( _, content ) ) ->
            head :: content

        _ ->
            let
                showNew =
                    compare

                groups =
                    groupOrder
                        |> List.map
                            (\g ->
                                ( g
                                , cards
                                    |> List.filter (\c -> c.group == g)
                                    |> List.map (\c -> ( ( c.cmc, Collate.key c.name ), c ))
                                    |> List.sortBy Tuple.first
                                    |> List.map Tuple.second
                                )
                            )
                        |> List.filter (\( _, cs ) -> not (List.isEmpty cs))

                galleryCtx =
                    Card.withGallery
                        (Card.galleryItems ctx.index
                            (List.concatMap (\( _, cs ) -> List.map (\c -> ( c.name, Just { image = c.image, scryfallUri = c.scryfallUri } )) cs) groups)
                        )
                        ctx
            in
            [ head
            , div [ class "list-toolbar" ]
                [ div [ class "segmented", attribute "role" "tablist", attribute "aria-label" "Decklist view" ]
                    [ button [ attribute "role" "tab", ariaSelected (model.decklistView == ListView), onClick (SetDecklistView ListView) ] [ text "List" ]
                    , button [ attribute "role" "tab", ariaSelected (model.decklistView == ImagesView), onClick (SetDecklistView ImagesView) ] [ text "Images" ]
                    ]
                , span [ class "muted small grow nowrap" ] [ text (String.fromFloat (List.sum (List.map .qty cards)) ++ " cards") ]
                ]
            , if model.decklistView == ImagesView then
                deckImages galleryCtx groups showNew

              else
                div [ class "decklist-groups" ]
                    (List.map
                        (\( group, cs ) ->
                            div [ class "deck-group" ]
                                [ h3 [] [ text (group ++ " "), muted ("(" ++ String.fromFloat (List.sum (List.map .qty cs)) ++ ")") ]
                                , ul []
                                    (List.map
                                        (\c ->
                                            li
                                                [ class
                                                    (if showNew && (c.isNew || c.delta > 0) then
                                                        "new"

                                                     else
                                                        ""
                                                    )
                                                ]
                                                [ span [ class "qty" ] [ text (String.fromFloat c.qty) ]
                                                , Card.nameWith galleryCtx { name = c.name, card = Just { image = c.image, scryfallUri = c.scryfallUri }, label = Nothing, class = Just "grow", key = Nothing }
                                                , if showNew then
                                                    newBadge c "badge new"

                                                  else
                                                    text ""
                                                , Mana.cost env.base 13 c.manaCost
                                                ]
                                        )
                                        cs
                                    )
                                ]
                        )
                        groups
                    )
            ]


sectionNav : Model -> List ( String, String ) -> Html Msg
sectionNav model sections =
    let
        active =
            case model.active of
                Just a ->
                    if List.any (\( id, _ ) -> id == a) sections then
                        Just a

                    else
                        List.head sections |> Maybe.map Tuple.first

                Nothing ->
                    List.head sections |> Maybe.map Tuple.first
    in
    nav [ class "section-nav", attribute "aria-label" "Report sections" ]
        (List.map
            (\( sectionId, label ) ->
                button
                    [ attribute "data-id" sectionId
                    , class
                        (if active == Just sectionId then
                            "active"

                         else
                            ""
                        )
                    , onClick (Activate sectionId)
                    ]
                    [ text label ]
            )
            sections
            ++ [ node "mtg-section-nav" [ on "activechange" (D.map Activate (D.field "detail" D.string)) ] [] ]
        )


stat : { label : String, before : Maybe Float, after : Float, better : Maybe Bool, format : Float -> String } -> Html msg
stat o =
    let
        changed =
            case o.before of
                Just b ->
                    b /= o.after

                Nothing ->
                    False
    in
    div [ class "stat" ]
        ([ span [ class "stat-label" ] [ text o.label ]
         , strong
            [ class
                (if changed && o.better /= Nothing then
                    let
                        good =
                            case ( o.before, o.better ) of
                                ( Just b, Just up ) ->
                                    if up then
                                        o.after > b

                                    else
                                        o.after < b

                                _ ->
                                    False
                    in
                    if good then
                        "ok"

                    else
                        "warn"

                 else
                    ""
                )
            ]
            [ text (o.format o.after) ]
         ]
            ++ (case ( changed, o.before ) of
                    ( True, Just b ) ->
                        [ span [ class "stat-was" ] [ text ("was " ++ o.format b) ] ]

                    _ ->
                        []
               )
        )


simple : String -> Float -> Html msg
simple label after =
    stat { label = label, before = Nothing, after = after, better = Nothing, format = String.fromFloat }


percent : Float -> String
percent n =
    String.fromFloat n ++ "%"


dollars : Float -> String
dollars n =
    "$" ++ String.fromInt (round n)


{-| Stats for the deck as submitted, and a way into the suggested changes.
-}
overview : Env -> Report -> Report -> String -> Html msg
overview env r full slug =
    let
        draw =
            List.Extra.find (\x -> x.role == RoleDraw) r.after.roles |> Maybe.map .count |> Maybe.withDefault 0

        target =
            Maybe.map .target full.bracket
    in
    section [ class "panel" ]
        [ panelHead { title = "Your deck", desc = Just [ text "How the deck plays as you built it." ], actions = Nothing, compact = False }
        , div [ class "stats" ]
            [ simple ("Lands (rec. " ++ String.fromFloat r.after.mana.recommendedLands ++ ")") r.after.mana.landCount
            , simple "Avg mana value" r.after.mana.avgCmc
            , simple "Interaction" (interaction r.after)
            , simple "Card draw" draw
            , stat { label = "Commander on curve", before = Nothing, after = r.after.sim.commanderOnCurve, better = Nothing, format = percent }
            , stat { label = "Mana screw", before = Nothing, after = r.after.sim.screwRate, better = Nothing, format = percent }
            , simple "Combos" (toFloat (List.length r.combosPresent))
            , stat { label = "Deck price", before = Nothing, after = r.after.totalPriceUsd, better = Nothing, format = dollars }
            ]
        , when (not (List.isEmpty full.swaps))
            (div [ class "overview-cta" ]
                [ p []
                    [ text "The doc prescribes "
                    , strong []
                        [ text
                            (String.fromInt (List.length full.swaps)
                                ++ " "
                                ++ (if List.length full.swaps == 1 then
                                        "swap"

                                    else
                                        "swaps"
                                   )
                            )
                        ]
                    , text
                        ((case target of
                            Just t ->
                                if t /= 0 then
                                    " to tune it for bracket " ++ String.fromFloat t

                                else
                                    ""

                            Nothing ->
                                ""
                         )
                            ++ (case full.options.budgetTotal of
                                    Just b ->
                                        if b /= 0 then
                                            " within your $" ++ String.fromFloat b ++ " budget"

                                        else
                                            ""

                                    Nothing ->
                                        ""
                               )
                            ++ "."
                        )
                    ]
                , a [ class "button primary", href (Route.deckHref env.isStatic slug Optimized) ] [ text "See the optimized deck" ]
                ]
            )
        ]


comboThumbs : Card.Ctx Msg -> List String -> Html Msg
comboThumbs ctx names =
    div [ class "combo-thumbs" ]
        (names
            |> List.take 3
            |> List.map
                (\n ->
                    case Dict.get n ctx.index |> Maybe.andThen .image of
                        Just image ->
                            Card.nameWith ctx
                                { name = n
                                , card = Nothing
                                , label = Just [ img [ class "card-thumb", src image, alt n, attribute "loading" "lazy" ] [] ]
                                , class = Nothing
                                , key = Nothing
                                }

                        Nothing ->
                            text ""
                )
        )


spellbookLink : Combo -> Html msg
spellbookLink combo =
    a
        [ href combo.url
        , target "_blank"
        , rel "noreferrer"
        , class "small spellbook-link"
        , attribute "aria-label" "View combo on Commander Spellbook"
        , title (String.join " · " combo.produces)
        ]
        [ text "↗" ]


{-| Combos in the deck and one card away in one list; a badge and accent tell them apart.
-}
combos : Card.Ctx Msg -> Model -> Report -> List (Html Msg)
combos ctx model r =
    let
        groups =
            Combos.groupByMissing r.combosOneAway

        present =
            r.combosPresent

        blocked =
            r.bracket |> Maybe.map .excluded |> Maybe.withDefault [] |> List.map (\e -> ( e.name, e.reason )) |> Dict.fromList

        shownPresent =
            if model.comboFilter == Away then
                []

            else
                present

        awayGroups =
            if model.comboFilter == Present then
                []

            else
                groups

        limit =
            if model.comboFilter == Away then
                8

            else
                5

        shownAway =
            if model.allCombos then
                awayGroups

            else
                List.take limit awayGroups

        tabs =
            [ ( AllCombos, "All", List.length present + List.length groups )
            , ( Present, "In deck", List.length present )
            , ( Away, "1 card away", List.length groups )
            ]
    in
    [ panelHead
        { title = "Combos"
        , desc = Just [ text "Infinite combos from Commander Spellbook, in your deck or one card away." ]
        , actions =
            Just
                [ div [ class "segmented", attribute "role" "tablist", attribute "aria-label" "Which combos" ]
                    (List.map
                        (\( f, label, n ) ->
                            button [ attribute "role" "tab", ariaSelected (model.comboFilter == f), onClick (SetComboFilter f) ]
                                [ text (label ++ " "), span [ class "count" ] [ text (String.fromInt n) ] ]
                        )
                        tabs
                    )
                ]
        , compact = False
        }
    , ul [ class "combo-rows" ]
        (List.map
            (\c ->
                li [ class "combo-row present" ]
                    [ comboThumbs ctx c.cards
                    , div [ class "combo-body" ]
                        [ div [ class "combo-title" ] (Card.list ctx " + " c.cards ++ [ text " ", spellbookLink c ])
                        , div [ class "combo-tags" ]
                            [ span [ class "badge new" ] [ text "✓ In your deck" ]
                            , span [ class "outcome" ] [ text (Combos.outcome c.produces) ]
                            ]
                        ]
                    ]
            )
            shownPresent
            ++ List.map
                (\g ->
                    let
                        reason =
                            Dict.get g.name blocked

                        price =
                            Dict.get g.name ctx.index |> Maybe.andThen .priceUsd
                    in
                    li [ class "combo-row away" ]
                        [ comboThumbs ctx [ g.name ]
                        , div [ class "combo-body" ]
                            [ div [ class "combo-title" ]
                                ([ muted "Add", text " ", strong [] [ Card.name ctx g.name ] ]
                                    ++ (case price of
                                            Just pr ->
                                                [ span [ class "muted small" ] [ text (" $" ++ toFixed 2 pr) ] ]

                                            Nothing ->
                                                []
                                       )
                                )
                            , div [ class "combo-tags" ]
                                [ span [ class "badge" ] [ text "1 card away" ]
                                , span [ class "outcome" ] [ text g.best ]
                                , when (List.length g.combos > 1) (span [ class "muted small" ] [ text ("completes " ++ String.fromInt (List.length g.combos) ++ " combos") ])
                                , maybeHtml reason
                                    (\why ->
                                        span [ class "badge warn", title why ]
                                            [ text ("Outside bracket " ++ (r.bracket |> Maybe.map (.target >> String.fromFloat) |> Maybe.withDefault "undefined")) ]
                                    )
                                ]
                            , ul [ class "combo-partners" ]
                                (List.map
                                    (\entry ->
                                        li []
                                            ([ span [ class "muted small" ] [ text "with" ], text " " ]
                                                ++ Card.list ctx " + " entry.partners
                                                ++ [ when (List.length g.combos > 1) (span [ class "muted small" ] [ text (" · " ++ entry.outcome) ])
                                                   , text " "
                                                   , spellbookLink entry.combo
                                                   ]
                                            )
                                    )
                                    g.combos
                                )
                            ]
                        ]
                )
                shownAway
        )
    , when (List.length shownPresent + List.length shownAway == 0) (p [ class "muted" ] [ text "None found." ])
    , when (List.length awayGroups > limit)
        (button [ class "ghost small-btn", onClick ToggleAllCombos ]
            [ text
                (if model.allCombos then
                    "Show fewer"

                 else
                    "Show all " ++ String.fromInt (List.length awayGroups) ++ " cards one away"
                )
            ]
        )
    ]


{-| Whether the published site shows the doc's suggestions or only the deck as submitted.
-}
publishToggle : Model -> Bool -> Html Msg
publishToggle model hidden =
    let
        published =
            not hidden
    in
    button
        [ class
            ("toggle "
                ++ (if published then
                        "on"

                    else
                        ""
                   )
            )
        , attribute "aria-pressed"
            (if published then
                "true"

             else
                "false"
            )
        , disabled model.publishBusy
        , onClick (TogglePublish (not published))
        , title
            (if hidden then
                "The published site shows only your deck as submitted"

             else
                "The published site shows the doc's suggestions too"
            )
        ]
        [ text "Publish suggestions" ]


exportMenu : Env -> Model -> String -> Maybe String -> List Swap -> Bool -> Html Msg
exportMenu env model slug edhrecUrl swaps optimized =
    let
        adds =
            List.foldl
                (\s acc ->
                    if List.any (\( n, _ ) -> n == s.in_) acc then
                        List.map
                            (\( n, q ) ->
                                if n == s.in_ then
                                    ( n, q + 1 )

                                else
                                    ( n, q )
                            )
                            acc

                    else
                        acc ++ [ ( s.in_, 1 ) ]
                )
                []
                swaps

        addsText =
            String.join "\n" (List.map (\( n, q ) -> String.fromInt q ++ " " ++ n) adds) ++ "\n"

        file name =
            Api.fileUrl env.isStatic slug name
    in
    details [ class "menu" ]
        [ summary [ class "button" ] [ text "Export ▾" ]
        , div [ class "menu-items" ]
            [ when (not (List.isEmpty adds))
                (button [ class "menu-item" ]
                    [ text
                        (if model.exportCopied then
                            "✓ Copied"

                         else
                            "Copy cards to add"
                        )
                    , span [ class "muted small" ] [ text (String.fromInt (List.length swaps)) ]
                    , node "mtg-copy" [ Html.Attributes.property "text" (Json.Encode.string addsText), on "copied" (D.succeed ExportCopied) ] []
                    ]
                )
            , a [ href (file "initial.txt"), attribute "download" (slug ++ "-initial.txt") ] [ text "Download your deck ", span [ class "muted small" ] [ text ".txt" ] ]
            , when optimized
                (a [ href (file "optimized.txt"), attribute "download" (slug ++ "-optimized.txt") ] [ text "Download the optimized deck ", span [ class "muted small" ] [ text ".txt" ] ])
            , a [ href (file "report.md"), attribute "download" (slug ++ "-report.md") ] [ text "Download the full report ", span [ class "muted small" ] [ text ".md" ] ]
            , when env.isStatic
                (a [ href ("decks/" ++ slug ++ "/"), target "_blank", rel "noreferrer" ] [ text "Plain-text version ", span [ class "muted small" ] [ text "for AI agents" ] ])
            , maybeHtml edhrecUrl (\url -> a [ href url, target "_blank", rel "noreferrer" ] [ text "View on EDHREC ↗" ])
            ]
        , node "mtg-outside-close" [ attribute "close" (String.fromInt model.exportClose) ] []
        ]


{-| "Your deck" / "Optimized" switch, placed in the sticky top bar so it's always in reach.
-}
viewToggle : Env -> String -> DeckView -> Int -> Html Msg
viewToggle env slug v swaps =
    div [ class "segmented view-toggle", attribute "role" "tablist", attribute "aria-label" "Which deck" ]
        [ button [ attribute "role" "tab", ariaSelected (v == Current), onClick (NavigateTo (Route.deckHref env.isStatic slug Current)) ] [ text "Your deck" ]
        , button [ attribute "role" "tab", ariaSelected (v == Optimized), onClick (NavigateTo (Route.deckHref env.isStatic slug Optimized)) ]
            (text "Optimized "
                :: (if swaps > 0 then
                        [ span [ class "count" ] [ text (String.fromInt swaps) ] ]

                    else
                        []
                   )
            )
        ]


{-| What the page draws outside the report: the view toggle in the top bar, the note while
changes are being made, and dialogs over the page.
-}
type alias Chrome =
    { updating : Bool
    , toggle : Maybe (Html Msg)
    , overlays : List (Html Msg)
    }


chrome : Env -> DeckView -> Model -> Chrome
chrome env requested model =
    case model.detail of
        Just detail ->
            case detail.report of
                Just full ->
                    let
                        shownView =
                            viewOf full requested
                    in
                    { updating = model.error == Nothing && detail.updating == Just True
                    , toggle =
                        if model.error == Nothing && hasBothViews full then
                            Just (viewToggle env model.slug shownView (List.length full.swaps))

                        else
                            Nothing
                    , overlays =
                        if model.error == Nothing && model.howToPlay then
                            let
                                optimized =
                                    shownView == Optimized

                                r =
                                    if optimized then
                                        full

                                    else
                                        (asOriginal full).r
                            in
                            [ HowToPlay.view
                                { base = env.base
                                , titleId = "_r_" ++ base32 model.modalCount ++ "_"
                                , onClose = CloseHowToPlay
                                , ctx = { index = Maybe.withDefault Dict.empty r.cardIndex, gallery = Nothing, canHover = env.canHover, lift = CardMsg }
                                }
                                r
                                (full.howToPlay
                                    |> Maybe.andThen
                                        (if optimized then
                                            .optimized

                                         else
                                            .original
                                        )
                                )
                            ]

                        else
                            []
                    }

                Nothing ->
                    { updating = False, toggle = Nothing, overlays = [] }

        Nothing ->
            { updating = False, toggle = Nothing, overlays = [] }


{-| The page itself. Drawn lazily: hovering a card elsewhere doesn't redraw the report.
-}
view : Env -> DeckView -> Model -> Html Msg
view env requested model =
    case ( model.error, model.detail ) of
        ( Just e, _ ) ->
            p [ class "error" ] [ text e ]

        ( Nothing, Nothing ) ->
            div [ class "loading" ] [ spinner, text " Loading deck…" ]

        ( Nothing, Just detail ) ->
            case detail.report of
                Nothing ->
                    section [ class "panel" ]
                        [ h1 []
                            [ text
                                (if List.isEmpty detail.meta.commanders then
                                    model.slug

                                 else
                                    String.join " + " detail.meta.commanders
                                )
                            ]
                        , p [] [ text "No report yet." ]
                        , when (not env.isStatic) (rerun model detail.meta.options)
                        ]

                Just full ->
                    viewReport env requested model detail full


viewReport : Env -> DeckView -> Model -> DeckDetail -> Report -> Html Msg
viewReport env requested model detail full =
    let
        shownView =
            viewOf full requested

        optimized =
            shownView == Optimized

        shown =
            if optimized then
                { r = full, single = False }

            else
                asOriginal full

        r =
            shown.r

        single =
            shown.single

        slug =
            model.slug

        listText =
            if optimized then
                model.optimizedText

            else
                Just detail.initial

        ctx =
            { index = Maybe.withDefault Dict.empty r.cardIndex
            , gallery = Nothing
            , canHover = env.canHover
            , lift = CardMsg
            }

        cmdr =
            List.head r.commanderCards

        hasCombos =
            not (List.isEmpty r.combosPresent) || not (List.isEmpty r.combosOneAway)

        showSynergies =
            not (List.isEmpty (Maybe.withDefault [] r.synergies)) || (not env.isStatic && optimized)

        sections =
            List.filterMap identity
                [ Maybe.map (\_ -> ( "bracket", "Bracket" )) r.bracket
                , Maybe.map (\_ -> ( "decklist", "Decklist" )) r.decklist
                , Just ( "mana", "Mana" )
                , Just ( "sim", "Goldfish" )
                , if hasCombos then
                    Just ( "combos", "Combos" )

                  else
                    Nothing
                , if showSynergies then
                    Just ( "synergies", "Synergies" )

                  else
                    Nothing
                , Maybe.map (\_ -> ( "research", "Research" )) r.research
                ]

        commanderCount =
            List.length r.commanderCards

        swapsCount =
            List.length r.swaps
    in
    div [ class "stack report" ]
        [ section [ class "hero", cssVars (auraOfCards r.commanderCards) ]
            [ maybeHtml (cmdr |> Maybe.andThen .imageArt)
                (\art ->
                    div [ class "hero-backdrop", attribute "aria-hidden" "true" ]
                        [ div [ class "hero-ambient", style "background-image" ("url(" ++ art ++ ")") ] []
                        , div [ class "hero-art", style "background-image" ("url(" ++ art ++ ")") ] []
                        ]
                )
            , div
                [ class
                    ("hero-cards "
                        ++ (if commanderCount > 1 then
                                "pair"

                            else
                                ""
                           )
                    )
                ]
                (List.map
                    (\c ->
                        case c.image of
                            Just image ->
                                button
                                    [ class "hero-card tilt"
                                    , attribute "aria-label" ("Show " ++ c.name ++ " full size")
                                    , onClick (ZoomCommander c)
                                    ]
                                    [ img [ src image, alt c.name ] []
                                    , span [ class "foil", attribute "aria-hidden" "true" ] []
                                    , node "mtg-tilt" [] []
                                    ]

                            Nothing ->
                                text ""
                    )
                    r.commanderCards
                )
            , div [ class "hero-head" ]
                [ div [ class "hero-kicker" ]
                    [ span [ class "hero-role" ] [ span [ attribute "aria-hidden" "true" ] [ text "♛" ], text " Commander" ]
                    , maybeHtml r.bracket
                        (\b ->
                            a
                                [ class "bracket-link"
                                , href "#bracket"
                                , preventDefaultOn "click" (D.succeed ( ScrollToBracket, True ))
                                ]
                                [ Bracket.badge b.after.bracket "sm"
                                , text ("Bracket " ++ String.fromFloat b.after.bracket ++ " · " ++ b.name)
                                ]
                        )
                    ]
                , div [ class "hero-title" ]
                    [ h1 []
                        [ text
                            (if List.isEmpty r.commanders then
                                slug

                             else
                                String.join " + " r.commanders
                            )
                        ]
                    , if commanderCount == 1 then
                        maybeHtml cmdr (\c -> Mana.cost env.base 20 (Just c.manaCost))

                      else
                        text ""
                    ]
                ]
            , div [ class "hero-text" ]
                (List.map
                    (\c ->
                        div [ class "commander-rules" ]
                            [ when (commanderCount > 1) (h2 [] [ text c.name ])
                            , div [ class "type-line" ]
                                [ span []
                                    (text c.typeLine
                                        :: (if nonEmptyMaybe c.power || nonEmptyMaybe c.loyalty then
                                                [ span [ class "type-sep" ] [ text " · " ]
                                                , span [ class "pt" ]
                                                    [ text
                                                        (case c.loyalty |> Maybe.andThen nonEmpty of
                                                            Just loyalty ->
                                                                "Loyalty " ++ loyalty

                                                            Nothing ->
                                                                Maybe.withDefault "undefined" c.power ++ "/" ++ Maybe.withDefault "undefined" c.toughness
                                                        )
                                                    ]
                                                ]

                                            else
                                                []
                                           )
                                    )
                                , when (commanderCount > 1) (Mana.cost env.base 17 (Just c.manaCost))
                                ]
                            , Mana.oracleText env.base 15 c.oracleText
                            ]
                    )
                    r.commanderCards
                )
            , div [ class "hero-foot" ]
                [ when (not (List.isEmpty r.themes))
                    (p [ class "hero-themes" ]
                        (List.indexedMap
                            (\i t ->
                                span []
                                    ((if i > 0 then
                                        [ span [ class "type-sep" ] [ text " · " ] ]

                                      else
                                        []
                                     )
                                        ++ [ text t ]
                                    )
                            )
                            r.themes
                        )
                    )
                , div [ class "hero-actions" ]
                    [ button [ class "primary", onClick OpenHowToPlay ] [ text "How to play" ]
                    , button [ disabled (listText == Nothing) ]
                        [ text
                            (if model.copied then
                                "✓ Copied"

                             else
                                "Copy decklist"
                            )
                        , node "mtg-copy"
                            [ Html.Attributes.property "text" (Json.Encode.string (Maybe.withDefault "" listText))
                            , on "copied" (D.succeed Copied)
                            ]
                            []
                        ]
                    , exportMenu env model slug (Maybe.map .url r.edhrec) full.swaps (full.suggestionsHidden /= Just True)
                    ]
                , p [ class "hero-meta" ]
                    ([ text "Updated "
                     , node "mtg-local-text" [ attribute "date" r.generatedAt ] []
                     ]
                        ++ (case r.edhrec |> Maybe.andThen .numDecks of
                                Just n ->
                                    if n /= 0 then
                                        [ text " · based on "
                                        , node "mtg-local-text" [ attribute "number" (String.fromFloat n) ] []
                                        , text " decks on EDHREC"
                                        ]

                                    else
                                        []

                                Nothing ->
                                    []
                           )
                    )
                ]
            ]
        , sectionNav model sections
        , if optimized then
            let
                ins =
                    List.sum (List.map (\s -> s.inCard |> Maybe.andThen .priceUsd |> Maybe.withDefault 0) r.swaps)
            in
            section [ class "panel" ]
                [ panelHead
                    { title = "Optimized deck"
                    , desc =
                        Just
                            [ text
                                ("How the deck plays with the doc's "
                                    ++ String.fromInt swapsCount
                                    ++ " "
                                    ++ (if swapsCount == 1 then
                                            "swap"

                                        else
                                            "swaps"
                                       )
                                    ++ (case r.bracket of
                                            Just b ->
                                                ", for bracket " ++ String.fromFloat b.target

                                            Nothing ->
                                                ""
                                       )
                                    ++ "."
                                )
                            ]
                    , actions = Nothing
                    , compact = False
                    }
                , when (r.strategy /= "")
                    (details [ class "disclosure plan-why" ]
                        [ summary [] [ text "Why these swaps" ]
                        , p [] (Card.prose ctx r.strategy)
                        ]
                    )
                , div [ class "stats" ]
                    [ simple "Swaps" (toFloat swapsCount)
                    , stat
                        { label = "Lands (rec. " ++ String.fromFloat r.after.mana.recommendedLands ++ ")"
                        , before = Just r.before.mana.landCount
                        , after = r.after.mana.landCount
                        , better = Just (r.before.mana.landCount < r.after.mana.recommendedLands)
                        , format = String.fromFloat
                        }
                    , stat { label = "Avg mana value", before = Just r.before.mana.avgCmc, after = r.after.mana.avgCmc, better = Just False, format = String.fromFloat }
                    , stat { label = "Interaction", before = Just (interaction r.before), after = interaction r.after, better = Just True, format = String.fromFloat }
                    , stat { label = "Commander on curve", before = Just r.before.sim.commanderOnCurve, after = r.after.sim.commanderOnCurve, better = Just True, format = percent }
                    , stat { label = "Mana screw", before = Just r.before.sim.screwRate, after = r.after.sim.screwRate, better = Just False, format = percent }
                    , stat { label = "Cost of new cards", before = Nothing, after = ins, better = Nothing, format = \n -> money (Just n) }
                    , stat
                        { label =
                            case r.options.budgetTotal |> Maybe.andThen nonZeroFloat of
                                Just b ->
                                    "Deck price (budget $" ++ String.fromFloat b ++ ")"

                                Nothing ->
                                    "Deck price"
                        , before = Just r.before.totalPriceUsd
                        , after = r.after.totalPriceUsd
                        , better =
                            case r.options.budgetTotal |> Maybe.andThen nonZeroFloat of
                                Just _ ->
                                    Just False

                                Nothing ->
                                    Nothing
                        , format = dollars
                        }
                    ]
                ]

          else
            overview env r full slug
        , maybeHtml r.bracket
            (\b ->
                section [ class "panel", id "bracket" ]
                    [ Bracket.panel ctx
                        b
                        (if env.isStatic then
                            Nothing

                         else
                            Just (targetBracket model b.target)
                        )
                    ]
            )
        , maybeHtml r.decklist
            (\cards ->
                section [ class "panel", id "decklist" ]
                    (decklist env
                        ctx
                        model
                        cards
                        optimized
                        (if optimized && (swapsCount > 0 || not (List.isEmpty (Maybe.withDefault [] r.edits))) then
                            Just ( swapsCount, swapList env ctx model r.swaps ++ [ editLog ctx r ] )

                         else
                            Nothing
                        )
                    )
            )
        , section [ class "panel", id "mana" ]
            [ panelHead
                { title = "Mana base"
                , desc = Just [ text "How many of your lands make each color, against how many a deck leaning on that color this much needs to cast its spells on time." ]
                , actions = Nothing
                , compact = False
                }
            , div [ class "split" ]
                [ div []
                    [ colorBars env ctx r.before r.after
                    , h3 [] [ text "Mana curve" ]
                    , p [ class "sub-desc" ] [ text "Spells at each mana value; lands not counted." ]
                    , curve single r.before r.after
                    ]
                , div []
                    [ manaAdvice env ctx model r
                    , landNotes ctx r
                    ]
                ]
            ]
        , section [ class "panel", id "sim" ]
            [ panelHead
                { title = "Goldfish simulation"
                , desc =
                    Just
                        [ node "mtg-local-text" [ attribute "number" (String.fromFloat r.after.sim.games) ] []
                        , text " solo games with a free mulligan and greedy land and ramp plays."
                        ]
                , actions = Nothing
                , compact = False
                }
            , div [ class "split" ]
                [ div []
                    [ h3 [ class "split-head" ] [ text "Mana development" ]
                    , div [ class "table-wrap" ] [ simTable single r.before r.after ]
                    ]
                , div []
                    [ h3 [ class "split-first" ] [ text "Card roles" ]
                    , div [ class "table-wrap" ] [ roles single r.before r.after ]
                    ]
                ]
            ]
        , when hasCombos (section [ class "panel", id "combos" ] (combos ctx model r))
        , when showSynergies (section [ class "panel", id "synergies" ] (synergies env ctx model r optimized))
        , maybeHtml r.research
            (\research ->
                section [ class "panel", id "research" ]
                    [ panelHead
                        { title = "Web research"
                        , desc = Just [ text ("What " ++ String.fromInt (List.length research.sources) ++ " guides and discussions say about this commander.") ]
                        , actions = Nothing
                        , compact = False
                        }
                    , details [ class "disclosure" ]
                        [ summary [] [ text "Read the summary" ]
                        , Markdown.view ctx research.summary
                        ]
                    , h3 [] [ text "Sources" ]
                    , ul [ class "sources" ]
                        (List.map
                            (\s ->
                                li []
                                    [ a [ href s.url, target "_blank", rel "noreferrer" ] [ text s.title ]
                                    , span [ class "source-host" ] [ text (hostOf s.url) ]
                                    ]
                            )
                            research.sources
                        )
                    ]
            )
        , when (not env.isStatic && not (List.isEmpty r.warnings))
            (section [ class "panel" ]
                [ h2 [] [ text "Warnings" ]
                , ul [ class "notes" ] (List.map (\w -> li [] [ text w ]) r.warnings)
                ]
            )
        , if env.isStatic then
            text ""

          else
            Html.map ChatMsg
                (Chat.view
                    { env = env
                    , slug = slug
                    , commander = String.join " + " r.commanders
                    , target =
                        if optimized then
                            EditTargetOptimized

                        else
                            EditTargetOriginal
                    , index = ctx.index
                    }
                    model.chat
                )
        , section [ class "panel" ]
            [ div [ class "row between" ]
                [ details [ class "disclosure" ]
                    [ summary [] [ text "Original list" ]
                    , pre [] [ text detail.initial ]
                    ]
                , when (not env.isStatic) (rerun model r.options)
                , when (not env.isStatic) (publishToggle model (detail.meta.hideSuggestions == Just True))
                ]
            ]
        ]


nonEmptyMaybe : Maybe String -> Bool
nonEmptyMaybe m =
    case m of
        Just s ->
            s /= ""

        Nothing ->
            False


nonZeroFloat : Float -> Maybe Float
nonZeroFloat n =
    if n == 0 then
        Nothing

    else
        Just n


landNotes : Card.Ctx Msg -> Report -> Html Msg
landNotes ctx r =
    let
        tapped =
            r.after.mana.tappedLands

        colorless =
            r.after.mana.colorlessLands
    in
    if List.isEmpty tapped && List.isEmpty colorless then
        text ""

    else
        dl [ class "land-notes" ]
            ((if List.isEmpty tapped then
                []

              else
                [ dt [] [ text "Enters tapped" ], dd [] (Card.list ctx ", " tapped) ]
             )
                ++ (if List.isEmpty colorless then
                        []

                    else
                        [ dt [] [ text "Colorless only" ], dd [] (Card.list ctx ", " colorless) ]
                   )
            )


editLog : Card.Ctx Msg -> Report -> Html Msg
editLog ctx r =
    let
        edits =
            Maybe.withDefault [] r.edits
    in
    when (not (List.isEmpty edits))
        (div [ class "swap-group edits" ]
            [ h3 [] [ text "Changes from chat ", muted ("· " ++ String.fromInt (List.length edits)) ]
            , ul [ class "edit-log" ]
                (List.map
                    (\e ->
                        li []
                            [ div [ class "edit-changes" ]
                                (List.map
                                    (\c ->
                                        span [ class ("edit-chip " ++ deckEditChangeActionToString c.action) ]
                                            [ text
                                                ((if c.action == DeckEditChangeActionAdd then
                                                    "+"

                                                  else
                                                    "−"
                                                 )
                                                    ++ " "
                                                    ++ (if c.qty > 1 then
                                                            String.fromFloat c.qty ++ " "

                                                        else
                                                            ""
                                                       )
                                                )
                                            , Card.name ctx c.name
                                            ]
                                    )
                                    e.changes
                                )
                            , div [ class "muted small" ]
                                [ when (e.target == Just DeckEditTargetOriginal) (span [ class "badge" ] [ text "Your deck" ])
                                , text
                                    (" "
                                        ++ (if e.request /= "" then
                                                "“" ++ e.request ++ "”"

                                            else
                                                ""
                                           )
                                    )
                                ]
                            ]
                    )
                    edits
                )
            ]
        )


{-| React's `useId` format, which the dialog's title id followed.
-}
base32 : Int -> String
base32 n =
    let
        digit d =
            String.slice d (d + 1) "0123456789abcdefghijklmnopqrstuv"
    in
    if n < 32 then
        digit n

    else
        base32 (n // 32) ++ digit (modBy 32 n)


closeHowToPlay : Msg
closeHowToPlay =
    CloseHowToPlay
