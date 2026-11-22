module Page.Report exposing (Chrome, ComboFilter, DecklistView, Model, Msg, Note(..), Out(..), Page, chrome, closeHowToPlay, decklistViewDecoder, decklistViewToString, init, load, subscriptions, update, view, viewChat)

import Api
import Chat
import Collate
import Combos
import Dict
import Env exposing (Env)
import Format exposing (money, toFixed)
import HowToPlay
import Html exposing (Html, a, article, button, dd, details, div, dl, dt, figcaption, figure, h1, h2, h3, header, img, label, li, nav, node, option, p, pre, section, select, span, strong, summary, table, tbody, td, text, th, thead, tr, ul)
import Html.Attributes exposing (attribute, disabled, selected, style)
import Html.Events exposing (on, onClick, preventDefaultOn)
import Html.Keyed as Keyed
import Html.Lazy
import Json.Decode as D
import Json.Encode
import List.Extra
import Loadable exposing (Loadable(..))
import Process
import Request exposing (Request(..), busyWith, failure, isBusy)
import Route exposing (DeckView(..))
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, href, id, rel, src, target, title)
import Ui.Bracket as Bracket
import Ui.Card as Card
import Ui.Gallery as Gallery
import Ui.Mana as Mana
import Ui.Markdown as Markdown
import Ui.Settings as Settings
import Ui.Sheet as Sheet
import Ui.Style exposing (ariaSelected, auraOfCards, cssVars)
import Url
import Views exposing (Shown, hasBothViews, viewOf)


pollMs : Float
pollMs =
    1000


type DecklistView
    = ListView
    | ImagesView


{-| As the page last saved it (in localStorage): images, or the list for anything else.
-}
decklistViewDecoder : D.Decoder DecklistView
decklistViewDecoder =
    D.map
        (\v ->
            if v == "images" then
                ImagesView

            else
                ListView
        )
        D.string


decklistViewToString : DecklistView -> String
decklistViewToString v =
    case v of
        ImagesView ->
            "images"

        ListView ->
            "list"


type ComboFilter
    = AllCombos
    | Present
    | Away


type Applier
    = SwapApplier
    | ManaApplier


{-| A change the page makes through the deck's edit queue: one of the doc's swaps (to the spells
or the mana base), or one of its suggested land swaps.
-}
type Edit
    = SwapEdit Applier Swap
    | LandEdit String


{-| Which list a swap's card is on: cut from the deck, or added to it.
-}
type Side
    = Cut
    | Added


{-| Everything the report shows, but the chat: the report renders lazily on this, so typing in
the chat (or a reply streaming in) doesn't render it again.
-}
type alias Page =
    { slug : String
    , deck : Loadable DeckDetail
    , pollToken : Int
    , status : DeckStatus
    , copied : Bool
    , copyToken : Int
    , optimizedText : Maybe String
    , howToPlay : Bool
    , modalCount : Int
    , showSwaps : Bool
    , decklistView : DecklistView
    , comboFilter : ComboFilter
    , allCombos : Bool
    , synergies : Request String
    , swaps : Request Swap
    , manaSwaps : Request Swap
    , landSwaps : Request String
    , target : Maybe Bracket
    , targetBusy : Bool

    -- Changing the settings to run the optimizer again (open while there are settings to change).
    , rerun : Maybe OptimizeOptions
    , publishBusy : Bool
    , exportCopied : Bool
    , exportClose : Int
    , active : Maybe String
    }


type alias Model =
    { page : Page
    , chat : Chat.Model
    }


setPage : (Page -> Page) -> Model -> Model
setPage f model =
    { model | page = f model.page }


type Msg
    = GotDetail (Result String DeckDetail)
    | PollDue Int
    | GotStatus Int (Result String DeckStatus)
    | GotList (Maybe String)
    | CopiedList
    | CopyNoticeEnded Int
    | ClickedHowToPlay
    | AskedToCloseHowToPlay
    | ToggledSwaps
    | ChoseDecklistView DecklistView
    | ChoseComboFilter ComboFilter
    | ToggledAllCombos
    | ClickedRefreshSynergies String
    | GotSynergies (Result String Report)
    | ClickedApply Edit
    | GotQueued Edit (Result String String)
    | EditPollDue Edit String
    | GotEdit Edit String (Result String EditStatus)
    | ChoseTarget Bracket
    | ClickedRunTarget Bracket
    | ClickedChangeRerun OptimizeOptions
    | ClickedCancelRerun
    | ChangedRerun OptimizeOptions
    | ClickedRunRerun OptimizeOptions
    | GotStarted (Result String ( String, String ))
    | ToggledPublish Bool
    | GotPublish (Result String DeckDetailMeta)
    | CopiedExport
    | ExportNoticeEnded
    | SectionActivated String
    | ClickedCommander Card
    | ClickedJumpTo String
    | ChatMsg Chat.Msg
    | CardMsg Card.Msg
    | ClickedViewTab String


type Out
    = Navigate String
    | OpenSheet Sheet.Model
    | Preview Card.Msg
    | SaveDecklistView DecklistView
    | ScrollTo String


init : Env -> DecklistView -> String -> ( Model, Cmd Msg )
init env decklistView slug =
    load env
        slug
        { chat = Chat.init
        , page =
            { slug = slug
            , deck = Loading
            , pollToken = 0
            , status = idle
            , copied = False
            , copyToken = 0
            , optimizedText = Nothing
            , howToPlay = False
            , modalCount = 0
            , showSwaps = False
            , decklistView = decklistView
            , comboFilter = AllCombos
            , allCombos = False
            , synergies = Idle
            , swaps = Idle
            , manaSwaps = Idle
            , landSwaps = Idle
            , target = Nothing
            , targetBusy = False
            , rerun = Nothing
            , publishBusy = False
            , exportCopied = False
            , exportClose = 0
            , active = Nothing
            }
        }


{-| Loads a deck into the page, keeping everything else as it was (the page stays the same
between decks, like the old UI did).
-}
load : Env -> String -> Model -> ( Model, Cmd Msg )
load env slug model =
    ( setPage (\p -> { p | slug = slug }) model
    , Cmd.batch
        [ Api.deck env.isStatic slug GotDetail
        , loadList env slug
        , if model.page.slug /= slug then
            Cmd.map ChatMsg (Chat.reload slug model.chat)

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
    , Cmd.batch [ Api.deck env.isStatic model.page.slug GotDetail, loadList env model.page.slug ]
    )


withReport : Report -> Model -> Model
withReport r =
    setPage (mapDetail (\d -> { d | report = Just r }))


detailOf : Page -> Maybe DeckDetail
detailOf page =
    Loadable.toMaybe page.deck


mapDetail : (DeckDetail -> DeckDetail) -> Page -> Page
mapDetail f page =
    { page | deck = Loadable.map f page.deck }


{-| Starts making an edit: it's sent to the deck's queue.
-}
send : String -> Edit -> Cmd Msg
send slug edit =
    case edit of
        SwapEdit _ swap ->
            Api.applySwap slug swap (GotQueued edit)

        LandEdit id ->
            Api.applyManaSuggestion slug id (GotQueued edit)


editBusy : Edit -> Page -> Page
editBusy edit page =
    case edit of
        SwapEdit SwapApplier swap ->
            { page | swaps = Busy swap }

        SwapEdit ManaApplier swap ->
            { page | manaSwaps = Busy swap }

        LandEdit id ->
            { page | landSwaps = Busy id }


{-| An edit is in, or failed (and why).
-}
editEnded : Edit -> Maybe String -> Page -> Page
editEnded edit failed page =
    let
        ended =
            case failed of
                Just e ->
                    Failed e

                Nothing ->
                    Idle
    in
    case edit of
        SwapEdit SwapApplier _ ->
            { page | swaps = ended }

        SwapEdit ManaApplier _ ->
            { page | manaSwaps = ended }

        LandEdit _ ->
            { page | landSwaps = ended }


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
            watch
                (setPage
                    (\p ->
                        { p
                            | deck = Loaded detail
                            , status = { changes = detail.changes, savedAt = detail.savedAt }
                        }
                    )
                    model
                )

        GotDetail (Err e) ->
            case model.page.deck of
                Loaded _ ->
                    -- What's on the page stays: it's the deck as it last was.
                    none model

                _ ->
                    none (setPage (\p -> { p | deck = Unavailable e }) model)

        PollDue token ->
            if token == model.page.pollToken then
                ( model, Api.status model.page.slug (GotStatus token), Nothing )

            else
                none model

        GotStatus token (Ok status) ->
            if token /= model.page.pollToken then
                none model

            else if status.savedAt /= model.page.status.savedAt then
                -- The report changed: an edit went in, or its refresh. The chat may have an offer.
                ( setPage (\p -> { p | status = status }) model
                , Cmd.batch
                    [ Api.deck env.isStatic model.page.slug GotDetail
                    , loadList env model.page.slug
                    , Cmd.map ChatMsg (Chat.reload model.page.slug model.chat)
                    ]
                , Nothing
                )

            else
                watch (setPage (\p -> { p | status = status }) model)

        GotStatus _ (Err _) ->
            none model

        GotList text ->
            none (setPage (\p -> { p | optimizedText = text }) model)

        CopiedList ->
            let
                token =
                    model.page.copyToken + 1
            in
            ( setPage (\p -> { p | copied = True, copyToken = token }) model
            , Process.sleep 1500 |> Task.perform (\_ -> CopyNoticeEnded token)
            , Nothing
            )

        CopyNoticeEnded token ->
            if token == model.page.copyToken then
                none (setPage (\p -> { p | copied = False }) model)

            else
                none model

        ClickedHowToPlay ->
            none (setPage (\p -> { p | howToPlay = True }) model)

        AskedToCloseHowToPlay ->
            none (setPage (\p -> { p | howToPlay = False, modalCount = model.page.modalCount + 1 }) model)

        ToggledSwaps ->
            none (setPage (\p -> { p | showSwaps = not model.page.showSwaps }) model)

        ChoseDecklistView v ->
            ( setPage (\p -> { p | decklistView = v }) model
            , Cmd.none
            , Just
                (SaveDecklistView v)
            )

        ChoseComboFilter f ->
            none (setPage (\p -> { p | comboFilter = f }) model)

        ToggledAllCombos ->
            none (setPage (\p -> { p | allCombos = not model.page.allCombos }) model)

        ClickedRefreshSynergies mode ->
            ( setPage (\p -> { p | synergies = Busy mode }) model
            , Api.refreshSynergies model.page.slug mode GotSynergies
            , Nothing
            )

        GotSynergies (Ok r) ->
            none (withReport r (setPage (\p -> { p | synergies = Idle }) model))

        GotSynergies (Err e) ->
            none (setPage (\p -> { p | synergies = Failed e }) model)

        ClickedApply edit ->
            ( setPage (editBusy edit) model, send model.page.slug edit, Nothing )

        GotQueued edit (Ok id) ->
            let
                ( m, cmd ) =
                    applied env Nothing model
            in
            ( m, Cmd.batch [ cmd, Api.edit id (GotEdit edit id) ], Nothing )

        GotQueued edit (Err e) ->
            none (setPage (editEnded edit (Just e)) model)

        EditPollDue edit id ->
            ( model, Api.edit id (GotEdit edit id), Nothing )

        GotEdit edit id (Ok status) ->
            case status.state of
                EditStateDone ->
                    plain (applied env Nothing (setPage (editEnded edit Nothing) model))

                EditStateFailed { error } ->
                    none (setPage (editEnded edit (Just error)) model)

                _ ->
                    ( model, Process.sleep pollMs |> Task.perform (\_ -> EditPollDue edit id), Nothing )

        GotEdit edit _ (Err e) ->
            none (setPage (editEnded edit (Just e)) model)

        ChoseTarget t ->
            none (setPage (\p -> { p | target = Just t }) model)

        ClickedRunTarget t ->
            case detailOf model.page |> Maybe.andThen .report of
                Just r ->
                    let
                        o =
                            r.options
                    in
                    ( setPage (\p -> { p | targetBusy = True }) model
                    , Api.reoptimize model.page.slug { o | bracket = Just t } GotStarted
                    , Nothing
                    )

                Nothing ->
                    none model

        ClickedChangeRerun o ->
            none (setPage (\p -> { p | rerun = Just o }) model)

        ClickedCancelRerun ->
            none (setPage (\p -> { p | rerun = Nothing }) model)

        ChangedRerun o ->
            none (setPage (\p -> { p | rerun = Just o }) model)

        ClickedRunRerun o ->
            ( model, Api.reoptimize model.page.slug o GotStarted, Nothing )

        GotStarted (Ok ( slug, jobId )) ->
            ( model, Cmd.none, Just (Navigate (Route.href env.isStatic (Route.Job slug jobId))) )

        GotStarted (Err _) ->
            none (setPage (\p -> { p | targetBusy = False }) model)

        ToggledPublish suggestions ->
            ( setPage (\p -> { p | publishBusy = True }) model, Api.setPublishing model.page.slug suggestions GotPublish, Nothing )

        GotPublish (Ok meta) ->
            none (setPage (\p -> mapDetail (\d -> { d | meta = meta }) { p | publishBusy = False }) model)

        GotPublish (Err _) ->
            none (setPage (\p -> { p | publishBusy = False }) model)

        CopiedExport ->
            ( setPage (\p -> { p | exportCopied = True }) model, Process.sleep 1000 |> Task.perform (\_ -> ExportNoticeEnded), Nothing )

        ExportNoticeEnded ->
            none (setPage (\p -> { p | exportCopied = False, exportClose = model.page.exportClose + 1 }) model)

        SectionActivated id ->
            none (setPage (\p -> { p | active = Just id }) model)

        ClickedCommander c ->
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
                                , foil = Just (auraOfCards (detailOf model.page |> Maybe.andThen .report |> Maybe.map .commanderCards |> Maybe.withDefault []))
                                }
                            )
                        )
                    )

                Nothing ->
                    none model

        ClickedJumpTo section ->
            ( model, Cmd.none, Just (ScrollTo section) )

        ChatMsg m ->
            let
                ( chat, cmd, out ) =
                    Chat.update env model.page.slug m model.chat

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

        ClickedViewTab href ->
            ( model, Cmd.none, Just (Navigate href) )


idle : DeckStatus
idle =
    { changes = DeckChangesSettled, savedAt = Nothing }


{-| Edits are being made, or worked out: the report will change.
-}
changing : DeckStatus -> Bool
changing status =
    status.changes /= DeckChangesSettled


{-| Checks on the deck again shortly while it's busy, to show what the edits change once it's in.
-}
watch : Model -> ( Model, Cmd Msg, Maybe Out )
watch model =
    let
        token =
            model.page.pollToken + 1
    in
    ( setPage (\p -> { p | pollToken = token }) model
    , if changing model.page.status then
        Process.sleep pollMs |> Task.perform (\_ -> PollDue token)

      else
        Cmd.none
    , Nothing
    )


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.map ChatMsg (Chat.subscriptions model.chat)



-- VIEWS OF THE REPORT


{-| What's printed in a card's corner: its loyalty, or its power and toughness (both, or neither).
-}
printedStats : Card -> Maybe String
printedStats c =
    case ( c.loyalty |> Maybe.andThen nonEmpty, c.power |> Maybe.andThen nonEmpty, c.toughness |> Maybe.andThen nonEmpty ) of
        ( Just loyalty, _, _ ) ->
            Just ("Loyalty " ++ loyalty)

        ( Nothing, Just power, Just toughness ) ->
            Just (power ++ "/" ++ toughness)

        _ ->
            Nothing


interaction : DeckSnapshot -> Int
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


miniCard : Env -> Card.Ctx msg -> Maybe Card -> String -> Side -> Html msg
miniCard env ctx card cardName side =
    div
        [ class
            ("mini-card "
                ++ (case side of
                        Cut ->
                            "out"

                        Added ->
                            "in"
                   )
            )
        ]
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
                    (case side of
                        Cut ->
                            "Cut"

                        Added ->
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


applyButton : Env -> Applier -> Request Swap -> Swap -> Html Msg
applyButton env which state swap =
    if env.isStatic then
        text ""

    else
        let
            busy =
                busyWith (\b -> b.out == swap.out && b.in_ == swap.in_) state
        in
        button
            [ class "small-btn"
            , disabled (isBusy state)
            , onClick (ClickedApply (SwapEdit which swap))
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
    if s.fromChat then
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


swapGroup : Env -> Card.Ctx Msg -> Request Swap -> String -> List Swap -> Html Msg
swapGroup env ctx state title swaps =
    if List.isEmpty swaps then
        text ""

    else
        div [ class "swap-group" ]
            [ h3 [] [ text (title ++ " "), muted ("· " ++ String.fromInt (List.length swaps)) ]
            , Keyed.node "div"
                [ class "swaps" ]
                (List.map
                    (\s ->
                        ( s.out ++ ">" ++ s.in_
                        , article [ class "swap" ]
                            [ div [ class "swap-head" ]
                                [ span [ class "badge" ] [ text (categoryLabel s) ]
                                , applyButton env SwapApplier state s
                                ]
                            , div [ class "swap-cards" ]
                                [ miniCard env ctx s.outCard s.out Cut
                                , div [ class "arrow", attribute "aria-hidden" "true" ] [ text "→" ]
                                , miniCard env ctx s.inCard s.in_ Added
                                ]
                            , div [ class "reason" ]
                                (p [] (Card.prose ctx s.reason)
                                    :: (case s.alternatives of
                                            (_ :: _) as alts ->
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
                    )
                    swaps
                )
            ]


swapList : Env -> Card.Ctx Msg -> Page -> List Swap -> List (Html Msg)
swapList env ctx model swaps =
    if List.isEmpty swaps then
        [ p [ class "muted" ] [ text "No swaps suggested. The deck already looks tight." ] ]

    else
        [ swapGroup env ctx model.swaps "Spells" (List.filter (not << isManaSwap) swaps)
        , swapGroup env ctx model.swaps "Mana base" (List.filter isManaSwap swaps)
        , maybeHtml (failure model.swaps) (\e -> p [ class "error small" ] [ text e ])
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


colorBars : Env -> Card.Ctx msg -> Maybe DeckSnapshot -> DeckSnapshot -> Html msg
colorBars env ctx before after =
    let
        beforeColors =
            before |> Maybe.map (.mana >> .colors) |> Maybe.withDefault []

        max =
            List.maximum
                (List.map (\c -> Basics.max c.targetSources c.landSources) after.mana.colors
                    ++ List.map .landSources beforeColors
                    ++ [ 1 ]
                )
                |> Maybe.withDefault 1
                |> toFloat

        beforeOf c =
            List.Extra.find (\x -> x.color == c.color) beforeColors

        changed =
            before /= Nothing && List.any (\c -> Maybe.map .landSources (beforeOf c) /= Just c.landSources) after.mana.colors
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
                            [ strong [] [ text (String.fromInt c.landSources) ]
                            , text " of the "
                            , strong [] [ text (String.fromInt c.targetSources) ]
                            , text (" lands we'd want make " ++ word)
                            , case b of
                                Just bb ->
                                    when (changed && bb.landSources /= c.landSources) (muted (" (was " ++ String.fromInt bb.landSources ++ ")"))

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
                                    String.fromInt gap ++ " short"

                                 else
                                    "enough"
                                )
                            ]
                        ]
                    , div [ class "bar-track" ]
                        [ when changed (div [ class "bar before", style "width" (pct (b |> Maybe.map .landSources |> Maybe.withDefault 0 |> toFloat) max) ] [])
                        , div
                            [ class
                                ("bar after "
                                    ++ (if changed then
                                            ""

                                        else
                                            "solo"
                                       )
                                )
                            , style "width" (pct (toFloat c.landSources) max)
                            ]
                            []
                        , div [ class "target", style "left" (pct (toFloat c.targetSources) max), title ("target " ++ String.fromInt c.targetSources) ] []
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
                                        " Your mana rocks and creatures add " ++ String.fromInt c.rampSources ++ " more " ++ word ++ " sources."

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


{-| The synergies among the deck's cards; on the suggested deck, a search for them can run again.
-}
synergies : Env -> Card.Ctx Msg -> Page -> Shown -> List (Html Msg)
synergies env ctx model shown =
    let
        items =
            shown.synergies

        canRefresh =
            shown.suggested /= Nothing

        image n =
            case Dict.get n ctx.index |> Maybe.andThen .image of
                Just i ->
                    Just i

                Nothing ->
                    shown.decklist |> List.Extra.find (\c -> c.name == n) |> Maybe.andThen .image

        busy =
            isBusy model.synergies

        refresh mode label =
            button [ class "small-btn", disabled busy, onClick (ClickedRefreshSynergies mode) ]
                ((if model.synergies == Busy mode then
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
    , maybeHtml (failure model.synergies) (\e -> p [ class "error small" ] [ text e ])
    , if List.isEmpty items then
        p [ class "muted" ] [ text "No synergies yet." ]

      else
        Keyed.ul [ class "synergies" ]
            (List.map
                (\syn ->
                    ( String.join "+" syn.cards
                    , li [ class "synergy" ]
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
                )
                items
            )
    ]


manaAdvice : Env -> Card.Ctx Msg -> Page -> Shown -> Html Msg
manaAdvice env ctx model shown =
    let
        changed =
            shown.suggested
                |> Maybe.map .swaps
                |> Maybe.withDefault []
                |> List.filter
                    (\s -> s.category == SwapCategoryMana && Maybe.map .isLand s.inCard == Just True && Maybe.map .isLand s.outCard == Just True)

        suggestions =
            shown.suggested |> Maybe.map .manaSuggestions |> Maybe.withDefault []

        issues =
            shown.deck.mana.issues
    in
    div [ class "mana-advice" ]
        ((if List.isEmpty changed then
            []

          else
            [ h3 [] [ text "What we changed" ]
            , Keyed.ul [ class "mana-changes" ]
                (List.map
                    (\s ->
                        ( s.out ++ ">" ++ s.in_
                        , li []
                            [ div [ class "mana-swap" ]
                                [ span [ class "mana-swap-chips" ]
                                    [ span [ class "edit-chip remove" ]
                                        [ text "− ", Card.nameWith ctx { name = s.out, card = Maybe.map cardLike s.outCard, label = Nothing, class = Nothing, key = Nothing } ]
                                    , muted "→"
                                    , span [ class "edit-chip add" ]
                                        [ text "+ ", Card.nameWith ctx { name = s.in_, card = Maybe.map cardLike s.inCard, label = Nothing, class = Nothing, key = Nothing } ]
                                    ]
                                , applyButton env ManaApplier model.manaSwaps s
                                ]
                            , div [ class "muted small" ] (Card.prose ctx s.reason)
                            ]
                        )
                    )
                    changed
                )
            , maybeHtml (failure model.manaSwaps) (\e -> p [ class "error small" ] [ text e ])
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
                                                    span [ class ("edit-chip " ++ changeActionToString c.action) ]
                                                        ([ text
                                                            (if c.action == ChangeActionAdd then
                                                                "+ "

                                                             else
                                                                "− "
                                                            )
                                                         , Card.nameWith ctx { name = c.name, card = Maybe.map cardLike c.card, label = Nothing, class = Nothing, key = Nothing }
                                                         ]
                                                            ++ (case ( c.action, c.card |> Maybe.andThen .priceUsd ) of
                                                                    ( ChangeActionAdd, Just price ) ->
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
                                                , disabled (isBusy model.landSwaps)
                                                , onClick (ClickedApply (LandEdit m.id))
                                                , title "Make this swap in your deck as submitted"
                                                ]
                                                [ if model.landSwaps == Busy m.id then
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
                    , maybeHtml (failure model.landSwaps) (\e -> p [ class "error small" ] [ text e ])
                    ]
               )
            ++ (if List.isEmpty issues then
                    []

                else
                    [ h3 [] [ text "Still worth a look" ]
                    , ul [ class "notes" ] (List.map (\n -> li [] [ text n ]) issues)
                    ]
               )
        )


{-| The mana curve of `after`, against `before`'s when there's a deck to compare with.
-}
curve : Maybe DeckSnapshot -> DeckSnapshot -> Html msg
curve before after =
    let
        keys =
            [ "0", "1", "2", "3", "4", "5", "6", "7+" ]

        -- Bar heights are fractions of the tallest: counted in cards, drawn in Floats.
        at snap k =
            Dict.get k snap.mana.curve |> Maybe.withDefault 0 |> toFloat

        -- Headroom above the tallest bar for its count label.
        max =
            (List.maximum (List.map (\k -> Basics.max (was k) (at after k)) keys ++ [ 1 ]) |> Maybe.withDefault 1) * 1.18

        was k =
            before |> Maybe.map (\b -> at b k) |> Maybe.withDefault (at after k)
    in
    figure [ class "curve-figure" ]
        [ div [ class "curve", attribute "role" "img", attribute "aria-label" "Mana curve, before and after" ]
            (List.map
                (\k ->
                    let
                        then_ =
                            was k

                        now =
                            at after k
                    in
                    div [ class "curve-col" ]
                        [ div [ class "curve-bars" ]
                            [ span
                                (class "curve-count"
                                    :: style "bottom" (pct (Basics.max then_ now) max)
                                    :: (if then_ /= now then
                                            [ title ("was " ++ String.fromFloat then_) ]

                                        else
                                            []
                                       )
                                )
                                [ text (String.fromFloat now) ]
                            , when (before /= Nothing) (div [ class "bar before", style "height" (pct then_ max), title ("before: " ++ String.fromFloat then_) ] [])
                            , div [ class "bar after", style "height" (pct now max), title ("after: " ++ String.fromFloat now) ] []
                            ]
                        , span [ class "curve-mv" ] [ text k ]
                        ]
                )
                keys
            )
        , figcaption [ class "legend" ]
            ((if before == Nothing then
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


simTable : Maybe DeckSnapshot -> DeckSnapshot -> Html msg
simTable before after =
    let
        turn d t =
            Dict.get (String.fromInt t) d |> Maybe.withDefault 0

        -- Each row: its label, the value, and whether higher is better and the unit.
        rows sim =
            ( "Mulligan rate", sim.mulliganRate, ( False, "%" ) )
                :: List.map
                    (\t -> ( "Land drop on turn " ++ String.fromInt t, turn sim.landDropByTurn t, ( True, "%" ) ))
                    [ 2, 3, 4, 5 ]
                ++ [ ( "Commander cast on curve", sim.commanderOnCurve, ( True, "%" ) )
                   , ( "Commander cast by turn 5", turn sim.commanderByTurn 5, ( True, "%" ) )
                   , ( "All colors by turn 3", sim.allColorsByTurn3, ( True, "%" ) )
                   , ( "Mana available turn 4", sim.avgManaTurn4, ( True, "" ) )
                   , ( "Mana screw (<3 lands on T4)", sim.screwRate, ( False, "%" ) )
                   , ( "Flood (10+ lands seen by T7)", sim.floodRate, ( False, "%" ) )
                   ]
    in
    case before of
        Nothing ->
            table [ class "data" ]
                [ tbody []
                    (List.map
                        (\( label, y, ( _, unit ) ) ->
                            tr [] [ td [] [ text label ], td [] [ strong [] [ text (String.fromFloat y ++ unit) ] ] ]
                        )
                        (rows after.sim)
                    )
                ]

        Just was ->
            table [ class "data" ]
                [ thead [] [ tr [] [ th [] [], th [] [ text "Before" ], th [] [ text "After" ], th [] [ text "Δ" ] ] ]
                , tbody []
                    (List.map2
                        (\( label, x, _ ) ( _, y, ( hib, unit ) ) ->
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
                        (rows was.sim)
                        (rows after.sim)
                    )
                ]


roles : Maybe DeckSnapshot -> DeckSnapshot -> Html msg
roles before after =
    table [ class "data" ]
        [ thead []
            [ tr []
                (th [] [ text "Role" ]
                    :: (case before of
                            Nothing ->
                                [ th [] [ text "Cards" ] ]

                            Just _ ->
                                [ th [] [ text "Before" ], th [] [ text "After" ] ]
                       )
                    ++ [ th [] [ text "Typical" ]
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
                                :: (case before of
                                        Nothing ->
                                            []

                                        Just was ->
                                            let
                                                b =
                                                    List.Extra.find (\x -> x.role == r.role) was.roles |> Maybe.map .count |> Maybe.withDefault 0
                                            in
                                            [ ( "before", td [] [ text (String.fromInt b) ] ) ]
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
                                        [ strong [] [ text (String.fromInt r.count) ] ]
                                    , td [ class "muted" ]
                                        [ text
                                            (case r.target of
                                                Just t ->
                                                    if t /= 0 then
                                                        String.fromInt t ++ "+"

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
targetBracket : Page -> Bracket -> Html Msg
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
                , on "change"
                    (D.at [ "target", "value" ] D.string
                        |> D.andThen
                            (\v ->
                                case String.toInt v |> Maybe.andThen bracketFromInt of
                                    Just b ->
                                        D.succeed (ChoseTarget b)

                                    Nothing ->
                                        D.fail ("Not a bracket: " ++ v)
                            )
                    )
                ]
                (List.map
                    (\b -> option [ Ui.Attr.optionValue (String.fromInt (bracketToInt b)), selected (b == target) ] [ text ("Bracket " ++ String.fromInt (bracketToInt b)) ])
                    bracketValues
                )
            ]
        , when (target /= current)
            (button [ class "primary", disabled model.targetBusy, onClick (ClickedRunTarget target) ]
                ((if model.targetBusy then
                    [ spinner ]

                  else
                    []
                 )
                    ++ [ text ("Re-run for bracket " ++ String.fromInt (bracketToInt target)) ]
                )
            )
        ]


{-| Running the optimizer again: the settings of the run that made this report, and a way to
change them. Opened, the settings are the review's, with Cancel and Run beneath.
-}
rerun : Page -> OptimizeOptions -> Html Msg
rerun model initial =
    section [ class "panel rerun-panel" ]
        (panelHead
            { title = "Run it again"
            , desc = Just [ text (Settings.summary initial) ]
            , actions =
                case model.rerun of
                    Just _ ->
                        Nothing

                    Nothing ->
                        Just [ button [ onClick (ClickedChangeRerun initial) ] [ text "Change and re-run" ] ]
            , compact = False
            }
            :: (case model.rerun of
                    Just opts ->
                        [ Settings.view { webResearch = True, onChange = ChangedRerun } opts
                        , div [ class "rerun-actions" ]
                            [ button [ class "ghost", onClick ClickedCancelRerun ] [ text "Cancel" ]
                            , button [ class "primary", onClick (ClickedRunRerun opts) ] [ text "Run" ]
                            ]
                        ]

                    Nothing ->
                        []
               )
        )


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
                    "+" ++ String.fromInt c.delta

                 else
                    "−" ++ String.fromInt -c.delta
                )
            ]

    else
        text ""


{-| Deck list as a visual grid of card images, grouped by type; tap a card to see it full size.
-}
deckImages : Card.Ctx Msg -> List ( String, List DecklistCard ) -> Html Msg
deckImages ctx groups =
    let
        items =
            Maybe.withDefault [] ctx.gallery

        open cardName =
            Gallery.focus (\it -> it.name == cardName) items
                |> Maybe.map (Card.ClickedGalleryCard >> CardMsg >> onClick)
    in
    Keyed.node "div"
        [ class "deck-images" ]
        (List.map
            (\( group, cards ) ->
                ( group
                , section []
                    [ h3 [] [ text (group ++ " "), muted ("(" ++ String.fromInt (List.sum (List.map .qty cards)) ++ ")") ]
                    , Keyed.ul []
                        (List.map
                            (\c ->
                                ( c.name
                                , li
                                    [ class
                                        ("deck-image "
                                            ++ (if c.isNew || c.delta > 0 then
                                                    "new"

                                                else
                                                    ""
                                               )
                                        )
                                    ]
                                    [ button
                                        (attribute "aria-label" ("Show " ++ c.name ++ " full size")
                                            :: (c.image |> Maybe.andThen (\_ -> open c.name) |> Maybe.map List.singleton |> Maybe.withDefault [])
                                        )
                                        ([ case c.image of
                                            Just image ->
                                                img [ src image, alt c.name, attribute "loading" "lazy" ] []

                                            Nothing ->
                                                span [ class "deck-image-missing" ] [ text c.name ]
                                         , when (c.qty > 1) (span [ class "deck-image-qty" ] [ text ("×" ++ String.fromInt c.qty) ])
                                         ]
                                            ++ (if c.isNew then
                                                    [ span [ class "deck-image-new" ] [ span [ attribute "aria-hidden" "true" ] [ text "✦" ], text " new" ] ]

                                                else if c.delta /= 0 then
                                                    [ newBadge c "deck-image-new" ]

                                                else
                                                    []
                                               )
                                        )
                                    ]
                                )
                            )
                            cards
                        )
                    ]
                )
            )
            groups
        )


{-| The deck's cards as a list or images and, on the optimized view, the swaps that made it. New
cards are marked: only the suggested deck has any.
-}
decklist : Env -> Card.Ctx Msg -> Page -> List DecklistCard -> Maybe ( Int, List (Html Msg) ) -> List (Html Msg)
decklist env ctx model cards swaps =
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
                            [ button [ onClick ToggledSwaps ]
                                (if swapsShown then
                                    [ text "Show decklist" ]

                                 else
                                    [ span [] [ text "Show swaps ", span [ class "count" ] [ text (String.fromInt count) ] ] ]
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
                    [ button [ attribute "role" "tab", ariaSelected (model.decklistView == ListView), onClick (ChoseDecklistView ListView) ] [ text "List" ]
                    , button [ attribute "role" "tab", ariaSelected (model.decklistView == ImagesView), onClick (ChoseDecklistView ImagesView) ] [ text "Images" ]
                    ]
                , span [ class "muted small grow nowrap" ] [ text (String.fromInt (List.sum (List.map .qty cards)) ++ " cards") ]
                ]
            , if model.decklistView == ImagesView then
                deckImages galleryCtx groups

              else
                -- Keyed by group and card, so a card in both lists keeps its row (and its loaded images)
                -- when the view changes, and only what's added or cut is made or removed.
                Keyed.node "div"
                    [ class "decklist-groups" ]
                    (List.map
                        (\( group, cs ) ->
                            ( group
                            , div [ class "deck-group" ]
                                [ h3 [] [ text (group ++ " "), muted ("(" ++ String.fromInt (List.sum (List.map .qty cs)) ++ ")") ]
                                , Keyed.ul []
                                    (List.map
                                        (\c ->
                                            ( c.name
                                            , li
                                                [ class
                                                    (if c.isNew || c.delta > 0 then
                                                        "new"

                                                     else
                                                        ""
                                                    )
                                                ]
                                                [ span [ class "qty" ] [ text (String.fromInt c.qty) ]
                                                , Card.nameWith galleryCtx { name = c.name, card = Just { image = c.image, scryfallUri = c.scryfallUri }, label = Nothing, class = Just "grow", key = Nothing }
                                                , newBadge c "badge new"
                                                , Mana.cost env.base 13 c.manaCost
                                                ]
                                            )
                                        )
                                        cs
                                    )
                                ]
                            )
                        )
                        groups
                    )
            ]


{-| What either view shows that has to load (the thumbnails of their combos and synergies, and
the mana symbols of both lists), fetched in the background once the page is up: switching views
finds them ready. Lazy on the report, which the model keeps, so it's worked out once.
-}
preloadImages : String -> Report -> Html msg
preloadImages base r =
    let
        index =
            r.cardIndex

        allCombos =
            r.combosPresent
                ++ r.combosOneAway
                ++ (r.original.combosPresent ++ r.original.combosOneAway)

        thumbs =
            (List.concatMap (\c -> c.cards ++ c.missing) allCombos ++ List.concatMap .cards r.synergies)
                |> List.filterMap (\n -> Dict.get n index |> Maybe.andThen .image)

        manaSymbols =
            (r.decklist ++ r.original.decklist)
                |> List.filterMap .manaCost
                |> List.concatMap Mana.costSymbols
                |> List.map (Mana.symbolUrl base)
    in
    node "mtg-preload" [ attribute "srcs" (String.join " " (List.Extra.unique (manaSymbols ++ thumbs))) ] []


sectionNav : Page -> List ( String, String ) -> Html Msg
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
                    , onClick (SectionActivated sectionId)
                    ]
                    [ text label ]
            )
            sections
            ++ [ node "mtg-section-nav" [ on "activechange" (D.map SectionActivated (D.field "detail" D.string)) ] [] ]
        )


stat : { label : String, before : Maybe number, after : number, better : Maybe Bool, format : number -> String } -> Html msg
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


{-| A count, on its own.
-}
whole : String -> Int -> Html msg
whole label after =
    stat { label = label, before = Nothing, after = after, better = Nothing, format = String.fromInt }


percent : Float -> String
percent n =
    String.fromFloat n ++ "%"


dollars : Float -> String
dollars n =
    "$" ++ String.fromInt (round n)


{-| Stats for the deck as submitted, and a way into the suggested changes.
-}
overview : Env -> String -> Shown -> Report -> Html msg
overview env slug shown full =
    let
        deck =
            shown.deck

        draw =
            List.Extra.find (\x -> x.role == RoleDraw) deck.roles |> Maybe.map .count |> Maybe.withDefault 0

        target =
            Maybe.map .target full.bracket
    in
    section [ class "panel" ]
        [ panelHead { title = "Your deck", desc = Just [ text "How the deck plays as you built it." ], actions = Nothing, compact = False }
        , div [ class "stats" ]
            [ whole ("Lands (rec. " ++ String.fromInt deck.mana.recommendedLands ++ ")") deck.mana.landCount
            , simple "Avg mana value" deck.mana.avgCmc
            , whole "Interaction" (interaction deck)
            , whole "Card draw" draw
            , stat { label = "Commander on curve", before = Nothing, after = deck.sim.commanderOnCurve, better = Nothing, format = percent }
            , stat { label = "Mana screw", before = Nothing, after = deck.sim.screwRate, better = Nothing, format = percent }
            , whole "Combos" (List.length shown.combosPresent)
            , stat { label = "Deck price", before = Nothing, after = deck.totalPriceUsd, better = Nothing, format = dollars }
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
                                " to tune it for bracket " ++ String.fromInt (bracketToInt t)

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
    Keyed.node "div"
        [ class "combo-thumbs" ]
        (names
            |> List.take 3
            |> List.map
                (\n ->
                    ( n
                    , case Dict.get n ctx.index |> Maybe.andThen .image of
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
combos : Card.Ctx Msg -> Page -> Shown -> List (Html Msg)
combos ctx model shown =
    let
        groups =
            Combos.groupByMissing shown.combosOneAway

        present =
            shown.combosPresent

        blocked =
            shown.suggested |> Maybe.map .excluded |> Maybe.withDefault [] |> List.map (\e -> ( e.name, e.reason )) |> Dict.fromList

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
                            button [ attribute "role" "tab", ariaSelected (model.comboFilter == f), onClick (ChoseComboFilter f) ]
                                [ span [] [ text (label ++ " "), span [ class "count" ] [ text (String.fromInt n) ] ] ]
                        )
                        tabs
                    )
                ]
        , compact = False
        }
    , Keyed.ul [ class "combo-rows" ]
        (List.map
            (\c ->
                ( "in " ++ String.join "+" c.cards
                , li [ class "combo-row present" ]
                    [ comboThumbs ctx c.cards
                    , div [ class "combo-body" ]
                        [ div [ class "combo-title" ] (Card.list ctx " + " c.cards ++ [ text "\u{00A0}", spellbookLink c ])
                        , div [ class "combo-tags" ]
                            [ span [ class "badge new" ] [ text "✓ In your deck" ]
                            , span [ class "outcome" ] [ text (Combos.outcome c.produces) ]
                            ]
                        ]
                    ]
                )
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
                    ( "away " ++ g.name
                    , li [ class "combo-row away" ]
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
                                            [ text ("Outside bracket " ++ (shown.bracket |> Maybe.map (.rules >> .target >> bracketToInt >> String.fromInt) |> Maybe.withDefault "")) ]
                                    )
                                ]
                            , ul [ class "combo-partners" ]
                                (List.map
                                    (\entry ->
                                        li []
                                            ([ span [ class "muted small" ] [ text "with" ], text " " ]
                                                ++ Card.list ctx " + " entry.partners
                                                ++ [ when (List.length g.combos > 1) (span [ class "muted small" ] [ text (" · " ++ entry.outcome) ])
                                                   , text "\u{00A0}"
                                                   , spellbookLink entry.combo
                                                   ]
                                            )
                                    )
                                    g.combos
                                )
                            ]
                        ]
                    )
                )
                shownAway
        )
    , when (List.length shownPresent + List.length shownAway == 0) (p [ class "muted" ] [ text "None found." ])
    , when (List.length awayGroups > limit)
        (button [ class "ghost small-btn", onClick ToggledAllCombos ]
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
publishToggle : Page -> Bool -> Html Msg
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
        , onClick (ToggledPublish (not published))
        , title
            (if hidden then
                "The published site shows only your deck as submitted"

             else
                "The published site shows the doc's suggestions too"
            )
        ]
        [ text "Publish suggestions" ]


exportMenu : Env -> Page -> String -> Maybe String -> List Swap -> Bool -> Html Msg
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
                    , node "mtg-copy" [ Html.Attributes.property "text" (Json.Encode.string addsText), on "copied" (D.succeed CopiedExport) ] []
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
        [ button [ attribute "role" "tab", ariaSelected (v == Current), onClick (ClickedViewTab (Route.deckHref env.isStatic slug Current)) ] [ text "Your deck" ]
        , button [ attribute "role" "tab", ariaSelected (v == Optimized), onClick (ClickedViewTab (Route.deckHref env.isStatic slug Optimized)) ]
            [ span []
                (text "Optimized "
                    :: (if swaps > 0 then
                            [ span [ class "count" ] [ text (String.fromInt swaps) ] ]

                        else
                            []
                       )
                )
            ]
        ]


{-| What the page draws outside the report: the view toggle in the top bar, the note while
changes are being made, and dialogs over the page.
-}
type alias Chrome =
    { note : Maybe Note
    , toggle : Maybe (Html Msg)
    , overlays : List (Html Msg)
    }


{-| What the page says about changes in progress. Waiting for the edits to stop says nothing:
the edit is already on the page.
-}
type Note
    = Updating
    | Refreshing


noteOf : DeckStatus -> Maybe Note
noteOf status =
    case status.changes of
        DeckChangesUpdating ->
            Just Updating

        DeckChangesRefreshing ->
            Just Refreshing

        _ ->
            Nothing


chrome : Env -> DeckView -> Page -> Chrome
chrome env requested model =
    case model.deck of
        Loaded detail ->
            case detail.report of
                Just full ->
                    let
                        shownView =
                            viewOf full requested
                    in
                    { note = noteOf model.status
                    , toggle =
                        if hasBothViews full then
                            Just (viewToggle env model.slug shownView (List.length full.swaps))

                        else
                            Nothing
                    , overlays =
                        if model.howToPlay then
                            let
                                optimized =
                                    shownView == Optimized
                            in
                            [ HowToPlay.view
                                { base = env.base
                                , titleId = "_r_" ++ base32 model.modalCount ++ "_"
                                , onClose = AskedToCloseHowToPlay
                                , ctx = { index = full.cardIndex, gallery = Nothing, canHover = env.canHover, lift = CardMsg }
                                }
                                { commanders = full.commanders
                                , commanderCards = full.commanderCards
                                , bracket = (Views.shown full requested).bracket
                                }
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
                    { note = Nothing, toggle = Nothing, overlays = [] }

        _ ->
            { note = Nothing, toggle = Nothing, overlays = [] }


{-| The page itself. Drawn lazily: hovering a card elsewhere doesn't redraw the report.
-}
view : Env -> DeckView -> Page -> Html Msg
view env requested model =
    case model.deck of
        Unavailable e ->
            p [ class "error" ] [ text e ]

        Loading ->
            div [ class "loading" ] [ spinner, text " Loading deck…" ]

        Loaded detail ->
            case detail.report of
                Nothing ->
                    div [ class "stack report" ]
                        [ section [ class "panel" ]
                            [ h1 []
                                [ text
                                    (if List.isEmpty detail.meta.commanders then
                                        model.slug

                                     else
                                        String.join " + " detail.meta.commanders
                                    )
                                ]
                            , p [] [ text "No report yet." ]
                            ]
                        , when (not env.isStatic) (rerun model detail.meta.options)
                        ]

                Just full ->
                    viewReport env requested model detail full


{-| The chat, beside the report rather than in it (its button and panel float over the page):
it changes with every key and every word of a reply, and the report mustn't render again for that.
-}
viewChat : Env -> DeckView -> Model -> List (Html Msg)
viewChat env requested model =
    case ( env.isStatic, detailOf model.page |> Maybe.andThen .report ) of
        ( False, Just full ) ->
            List.map (Html.map ChatMsg)
                (Chat.view
                    { env = env
                    , slug = model.page.slug
                    , commander = String.join " + " full.commanders
                    , target =
                        if viewOf full requested == Optimized then
                            EditTargetOptimized

                        else
                            EditTargetOriginal
                    , index = full.cardIndex
                    }
                    model.chat
                )

        _ ->
            []


viewReport : Env -> DeckView -> Page -> DeckDetail -> Report -> Html Msg
viewReport env requested model detail full =
    let
        shown =
            Views.shown full requested

        optimized =
            shown.suggested /= Nothing

        before =
            Maybe.map .before shown.suggested

        slug =
            model.slug

        listText =
            if optimized then
                model.optimizedText

            else
                Just detail.initial

        ctx =
            { index = full.cardIndex
            , gallery = Nothing
            , canHover = env.canHover
            , lift = CardMsg
            }

        cmdr =
            List.head full.commanderCards

        hasCombos =
            not (List.isEmpty shown.combosPresent) || not (List.isEmpty shown.combosOneAway)

        showSynergies =
            not (List.isEmpty shown.synergies) || (not env.isStatic && optimized)

        sections =
            List.filterMap identity
                [ Maybe.map (\_ -> ( "bracket", "Bracket" )) shown.bracket
                , Just ( "decklist", "Decklist" )
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
                , Maybe.map (\_ -> ( "research", "Research" )) full.research
                ]

        commanderCount =
            List.length full.commanderCards
    in
    div [ class "stack report" ]
        [ section [ class "hero", cssVars (auraOfCards full.commanderCards) ]
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
                                    , onClick (ClickedCommander c)
                                    ]
                                    [ img [ src image, alt c.name ] []
                                    , span [ class "foil", attribute "aria-hidden" "true" ] []
                                    , node "mtg-tilt" [] []
                                    ]

                            Nothing ->
                                text ""
                    )
                    full.commanderCards
                )
            , div [ class "hero-head" ]
                [ div [ class "hero-kicker" ]
                    [ span [ class "hero-role" ] [ span [ attribute "aria-hidden" "true" ] [ text "♛" ], text " Commander" ]
                    , maybeHtml shown.bracket
                        (\b ->
                            a
                                [ class "bracket-link"
                                , href "#bracket"
                                , preventDefaultOn "click" (D.succeed ( ClickedJumpTo "bracket", True ))
                                ]
                                [ Bracket.badge b.assessment.bracket "sm"
                                , text ("Bracket " ++ String.fromInt (bracketToInt b.assessment.bracket) ++ " · " ++ b.rules.name)
                                ]
                        )
                    ]
                , div [ class "hero-title" ]
                    [ h1 []
                        [ text
                            (if List.isEmpty full.commanders then
                                slug

                             else
                                String.join " + " full.commanders
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
                                        :: (case printedStats c of
                                                Just stats ->
                                                    [ span [ class "type-sep" ] [ text " · " ]
                                                    , span [ class "pt" ] [ text stats ]
                                                    ]

                                                Nothing ->
                                                    []
                                           )
                                    )
                                , when (commanderCount > 1) (Mana.cost env.base 17 (Just c.manaCost))
                                ]
                            , Mana.oracleText env.base 15 c.oracleText
                            ]
                    )
                    full.commanderCards
                )
            , div [ class "hero-foot" ]
                [ when (not (List.isEmpty full.themes))
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
                            full.themes
                        )
                    )
                , div [ class "hero-actions" ]
                    [ button [ class "primary", onClick ClickedHowToPlay ] [ text "How to play" ]
                    , button [ disabled (listText == Nothing) ]
                        [ text
                            (if model.copied then
                                "✓ Copied"

                             else
                                "Copy decklist"
                            )
                        , node "mtg-copy"
                            [ Html.Attributes.property "text" (Json.Encode.string (Maybe.withDefault "" listText))
                            , on "copied" (D.succeed CopiedList)
                            ]
                            []
                        ]
                    , exportMenu env model slug (Maybe.map .url full.edhrec) full.swaps (not full.suggestionsHidden)
                    ]
                , p [ class "hero-meta" ]
                    ([ text "Updated "
                     , node "mtg-local-text" [ attribute "date" full.generatedAt ] []
                     ]
                        ++ (case full.edhrec |> Maybe.andThen .numDecks of
                                Just n ->
                                    if n /= 0 then
                                        [ text " · based on "
                                        , node "mtg-local-text" [ attribute "number" (String.fromInt n) ] []
                                        , text " decks on EDHREC"
                                        ]

                                    else
                                        []

                                Nothing ->
                                    []
                           )
                        ++ (if detail.hasRun then
                                [ text " · "
                                , Html.a [ class "hero-replay", href (Route.href env.isStatic (Route.Run slug)) ]
                                    [ text "▶ Replay how the doc made it" ]
                                ]

                            else
                                []
                           )
                    )
                ]
            ]
        , Html.Lazy.lazy2 preloadImages env.base full
        , sectionNav model sections
        , case shown.suggested of
            Just suggested ->
                let
                    ins =
                        List.sum (List.map (\s -> s.inCard |> Maybe.andThen .priceUsd |> Maybe.withDefault 0) suggested.swaps)

                    swapsCount =
                        List.length suggested.swaps

                    was =
                        suggested.before

                    deck =
                        shown.deck
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
                                        ++ (case shown.bracket of
                                                Just b ->
                                                    ", for bracket " ++ String.fromInt (bracketToInt b.rules.target)

                                                Nothing ->
                                                    ""
                                           )
                                        ++ "."
                                    )
                                ]
                        , actions = Nothing
                        , compact = False
                        }
                    , when (suggested.strategy /= "")
                        (details [ class "disclosure plan-why" ]
                            [ summary [] [ text "Why these swaps" ]
                            , p [] (Card.prose ctx suggested.strategy)
                            ]
                        )
                    , div [ class "stats" ]
                        [ whole "Swaps" swapsCount
                        , stat
                            { label = "Lands (rec. " ++ String.fromInt deck.mana.recommendedLands ++ ")"
                            , before = Just was.mana.landCount
                            , after = deck.mana.landCount
                            , better = Just (was.mana.landCount < deck.mana.recommendedLands)
                            , format = String.fromInt
                            }
                        , stat { label = "Avg mana value", before = Just was.mana.avgCmc, after = deck.mana.avgCmc, better = Just False, format = String.fromFloat }
                        , stat { label = "Interaction", before = Just (interaction was), after = interaction deck, better = Just True, format = String.fromInt }
                        , stat { label = "Commander on curve", before = Just was.sim.commanderOnCurve, after = deck.sim.commanderOnCurve, better = Just True, format = percent }
                        , stat { label = "Mana screw", before = Just was.sim.screwRate, after = deck.sim.screwRate, better = Just False, format = percent }
                        , stat { label = "Cost of new cards", before = Nothing, after = ins, better = Nothing, format = \n -> money (Just n) }
                        , stat
                            { label =
                                case full.options.budgetTotal |> Maybe.andThen nonZeroFloat of
                                    Just b ->
                                        "Deck price (budget $" ++ String.fromFloat b ++ ")"

                                    Nothing ->
                                        "Deck price"
                            , before = Just was.totalPriceUsd
                            , after = deck.totalPriceUsd
                            , better =
                                case full.options.budgetTotal |> Maybe.andThen nonZeroFloat of
                                    Just _ ->
                                        Just False

                                    Nothing ->
                                        Nothing
                            , format = dollars
                            }
                        ]
                    ]

            Nothing ->
                overview env slug shown full
        , maybeHtml shown.bracket
            (\b ->
                section [ class "panel", id "bracket" ]
                    [ Bracket.panel ctx
                        b.rules
                        { assessment = b.assessment
                        , before = shown.suggested |> Maybe.andThen .bracketBefore
                        , excluded = shown.suggested |> Maybe.map .excluded |> Maybe.withDefault []
                        , actions =
                            if env.isStatic then
                                Nothing

                            else
                                Just (targetBracket model b.rules.target)
                        , toCombos =
                            if hasCombos then
                                Just (ClickedJumpTo "combos")

                            else
                                Nothing
                        }
                    ]
            )
        , section [ class "panel", id "decklist" ]
            (decklist env
                ctx
                model
                shown.decklist
                (shown.suggested
                    |> Maybe.andThen
                        (\suggested ->
                            if List.isEmpty suggested.swaps && List.isEmpty suggested.edits then
                                Nothing

                            else
                                Just ( List.length suggested.swaps, swapList env ctx model suggested.swaps ++ [ editLog ctx suggested.edits ] )
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
                    [ colorBars env ctx before shown.deck
                    , h3 [] [ text "Mana curve" ]
                    , p [ class "sub-desc" ] [ text "Spells at each mana value; lands not counted." ]
                    , curve before shown.deck
                    ]
                , div []
                    [ manaAdvice env ctx model shown
                    , landNotes ctx shown.deck
                    ]
                ]
            ]
        , section [ class "panel", id "sim" ]
            [ panelHead
                { title = "Goldfish simulation"
                , desc =
                    Just
                        [ node "mtg-local-text" [ attribute "number" (String.fromInt shown.deck.sim.games) ] []
                        , text " solo games with a free mulligan and greedy land and ramp plays."
                        ]
                , actions = Nothing
                , compact = False
                }
            , div [ class "split" ]
                [ div []
                    [ h3 [ class "split-head" ] [ text "Mana development" ]
                    , div [ class "table-wrap" ] [ simTable before shown.deck ]
                    ]
                , div []
                    [ h3 [ class "split-first" ] [ text "Card roles" ]
                    , div [ class "table-wrap" ] [ roles before shown.deck ]
                    ]
                ]
            ]
        , when hasCombos (section [ class "panel", id "combos" ] (combos ctx model shown))
        , when showSynergies (section [ class "panel", id "synergies" ] (synergies env ctx model shown))
        , maybeHtml full.research
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
        , when (not env.isStatic && not (List.isEmpty full.warnings))
            (section [ class "panel" ]
                [ h2 [] [ text "Warnings" ]
                , ul [ class "notes" ] (List.map (\w -> li [] [ text w ]) full.warnings)
                ]
            )
        , when (not env.isStatic) (rerun model full.options)
        , section [ class "panel report-footer" ]
            [ details [ class "disclosure" ]
                [ summary [] [ text "Original list" ]
                , pre [] [ text detail.initial ]
                ]
            , when (not env.isStatic) (publishToggle model detail.meta.hideSuggestions)
            ]
        ]


nonZeroFloat : Float -> Maybe Float
nonZeroFloat n =
    if n == 0 then
        Nothing

    else
        Just n


landNotes : Card.Ctx Msg -> DeckSnapshot -> Html Msg
landNotes ctx deck =
    let
        tapped =
            deck.mana.tappedLands

        colorless =
            deck.mana.colorlessLands
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


editLog : Card.Ctx Msg -> List DeckEdit -> Html Msg
editLog ctx edits =
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
                                        span [ class ("edit-chip " ++ changeActionToString c.action) ]
                                            [ text
                                                ((if c.action == ChangeActionAdd then
                                                    "+"

                                                  else
                                                    "−"
                                                 )
                                                    ++ " "
                                                    ++ (if c.qty > 1 then
                                                            String.fromInt c.qty ++ " "

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
    AskedToCloseHowToPlay
