port module Main exposing (Model, Msg, Page, Shell, main)

import Api
import Browser
import Browser.Events
import CardSearch
import Env exposing (Env)
import Html exposing (Html, a, button, div, header, img, main_, node, p, span, text)
import Html.Attributes exposing (attribute, height, width)
import Html.Events exposing (on, onClick)
import Html.Lazy
import Json.Decode as D
import Json.Encode as E
import Loadable
import Page.Home as Home
import Page.Progress as Progress
import Page.Report as Report
import Page.Review as Review
import Route exposing (Route(..))
import Types exposing (AppConfig, DeckSummary, Recognition, deckSummaryDecoder)
import Ui.Attr exposing (alt, class, href, id, src, title)
import Ui.Card as Card
import Ui.Icons as Icons
import Ui.Keys as Keys
import Ui.Sheet as Sheet


port navigate : String -> Cmd msg


port saveDecklistView : String -> Cmd msg


port searchCards : E.Value -> Cmd msg


port scrollIntoView : String -> Cmd msg


port cardHits : (D.Value -> msg) -> Sub msg


port routeChanged : (D.Value -> msg) -> Sub msg


port mediaChanged : (D.Value -> msg) -> Sub msg


type Page
    = HomePage Home.Model
    | ReviewPage Review.Model
    | ProgressPage Progress.Model
    | ReportPage Report.Model


type alias Model =
    { env : Env
    , route : Route
    , config : Maybe AppConfig
    , recognition : Maybe ( Recognition, List String )
    , page : Page
    , search : Maybe CardSearch.Model
    , hovers : List Card.Hover
    , sheet : Maybe Sheet.Model
    , decklistView : Report.DecklistView

    -- The deck list as Home last had it, for Home to draw at once when it's back.
    , decks : Maybe (List DeckSummary)
    }


type Msg
    = RouteChanged D.Value
    | GotConfig (Maybe AppConfig)
    | GoBack
    | HomeMsg Home.Msg
    | ReviewMsg Review.Msg
    | ProgressMsg Progress.Msg
    | ReportMsg Report.Msg
    | OpenSearch
    | SearchMsg CardSearch.Msg
    | GotHits D.Value
    | SheetMsg Sheet.Msg
    | Escape
    | Resized Int Int
    | MediaChanged D.Value


type alias Flags =
    { env : Env, decklistView : Report.DecklistView, route : Route, decks : Maybe (List DeckSummary) }


flagsDecoder : D.Decoder Flags
flagsDecoder =
    D.map4 Flags
        Env.decoder
        (D.field "decklistView" Report.decklistViewDecoder)
        (D.field "route" Route.decoder)
        (D.field "decks" (D.nullable (D.list deckSummaryDecoder)))


{-| The app, running on the flags it was started with; or, if they don't parse, not running at all
rather than guessing (a published page taken for the local app would call an API that isn't there).
-}
type Shell
    = Running Model
    | Broken String


main : Program D.Value Shell Msg
main =
    Browser.element
        { init =
            \value ->
                case D.decodeValue flagsDecoder value of
                    Ok flags ->
                        Tuple.mapFirst Running (init flags)

                    Err e ->
                        ( Broken (D.errorToString e), Cmd.none )
        , update =
            \msg shell ->
                case shell of
                    Running model ->
                        Tuple.mapFirst Running (update msg model)

                    Broken _ ->
                        ( shell, Cmd.none )
        , view =
            \shell ->
                case shell of
                    Running model ->
                        view model

                    Broken e ->
                        p [ class "error" ] [ text ("The page couldn't start: " ++ e) ]
        , subscriptions =
            \shell ->
                case shell of
                    Running model ->
                        subscriptions model

                    Broken _ ->
                        Sub.none
        }


init : Flags -> ( Model, Cmd Msg )
init flags =
    let
        ( home, homeCmd ) =
            Home.init flags.env flags.decks

        model =
            { env = flags.env
            , route = Home
            , config = Nothing
            , recognition = Nothing
            , page = HomePage home
            , search = Nothing
            , hovers = []
            , sheet = Nothing
            , decklistView = flags.decklistView
            , decks = flags.decks
            }

        ( routed, routeCmd ) =
            if flags.route == Home then
                ( model, Cmd.map HomeMsg homeCmd )

            else
                enter flags.route model
    in
    ( routed, Cmd.batch [ routeCmd, Api.config flags.env.isStatic GotConfig ] )


{-| The page for a route. A deck's page stays as it is between decks and views, like the old UI's
did; other pages start afresh.
-}
enter : Route -> Model -> ( Model, Cmd Msg )
enter route model =
    let
        cleared =
            { model
                | route = route
                , hovers = []
                , sheet = Nothing
                , decks =
                    case model.page of
                        HomePage home ->
                            case Loadable.toMaybe home.decks of
                                Just decks ->
                                    Just decks

                                Nothing ->
                                    model.decks

                        _ ->
                            model.decks
            }
    in
    case route of
        Home ->
            case model.recognition of
                Just ( result, photos ) ->
                    case model.page of
                        ReviewPage _ ->
                            ( cleared, Cmd.none )

                        _ ->
                            ( { cleared | page = ReviewPage (Review.init result photos model.config) }, Cmd.none )

                Nothing ->
                    let
                        ( home, cmd ) =
                            Home.init model.env model.decks
                    in
                    ( { cleared | page = HomePage home }, Cmd.map HomeMsg cmd )

        Deck slug _ ->
            case model.page of
                ReportPage report ->
                    let
                        ( next, cmd ) =
                            if report.page.slug == slug then
                                ( report, Cmd.none )

                            else
                                Report.load model.env slug report
                    in
                    ( { cleared | page = ReportPage next }, Cmd.map ReportMsg cmd )

                _ ->
                    let
                        ( report, cmd ) =
                            Report.init model.env model.decklistView slug
                    in
                    ( { cleared | page = ReportPage report }, Cmd.map ReportMsg cmd )

        Job _ jobId ->
            let
                ( progress, cmd ) =
                    Progress.init jobId
            in
            ( { cleared | page = ProgressPage progress }, Cmd.map ProgressMsg cmd )

        Run slug ->
            let
                ( progress, cmd ) =
                    Progress.initSaved model.env slug
            in
            ( { cleared | page = ProgressPage progress }, Cmd.map ProgressMsg cmd )


go : Route -> Model -> Cmd Msg
go route model =
    navigate (Route.href model.env.isStatic route)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        RouteChanged value ->
            case D.decodeValue Route.decoder value of
                Ok route ->
                    enter route model

                Err _ ->
                    ( model, Cmd.none )

        GotConfig config ->
            ( { model | config = config }, Cmd.none )

        GoBack ->
            case model.route of
                -- A replay is of a deck's run: back is to that deck.
                Run slug ->
                    ( model, go (Deck slug Route.Optimized) model )

                _ ->
                    let
                        ( next, cmd ) =
                            if model.route == Home then
                                enter Home { model | recognition = Nothing }

                            else
                                ( { model | recognition = Nothing }, Cmd.none )
                    in
                    ( next, Cmd.batch [ cmd, go Home model ] )

        HomeMsg m ->
            case model.page of
                HomePage home ->
                    let
                        ( next, cmd, out ) =
                            Home.update model.config m home

                        updated =
                            { model | page = HomePage next }
                    in
                    case out of
                        Just (Home.Recognized result photos) ->
                            ( { updated
                                | recognition = Just ( result, photos )
                                , page = ReviewPage (Review.init result photos model.config)
                              }
                            , Cmd.map HomeMsg cmd
                            )

                        Just (Home.Preview cm) ->
                            card cm updated

                        Nothing ->
                            ( updated, Cmd.map HomeMsg cmd )

                _ ->
                    ( model, Cmd.none )

        ReviewMsg m ->
            case model.page of
                ReviewPage review ->
                    let
                        ( next, cmd, out ) =
                            Review.update m review

                        updated =
                            { model | page = ReviewPage next }

                        mapped =
                            Cmd.map ReviewMsg cmd
                    in
                    case out of
                        Just (Review.Done slug jobId) ->
                            ( { updated | recognition = Nothing }, Cmd.batch [ mapped, go (Job slug jobId) model ] )

                        Just Review.StartOver ->
                            let
                                ( home, homeCmd ) =
                                    Home.init model.env model.decks
                            in
                            ( { updated | recognition = Nothing, page = HomePage home }
                            , Cmd.batch [ mapped, Cmd.map HomeMsg homeCmd ]
                            )

                        Just (Review.OpenSheet sheet) ->
                            ( { updated | sheet = Just sheet }, mapped )

                        Just (Review.Preview cm) ->
                            card cm updated

                        Nothing ->
                            ( updated, mapped )

                _ ->
                    ( model, Cmd.none )

        ProgressMsg m ->
            case model.page of
                ProgressPage progress ->
                    let
                        ( next, cmd, finished ) =
                            Progress.update m progress
                    in
                    ( { model | page = ProgressPage next }
                    , Cmd.batch
                        [ Cmd.map ProgressMsg cmd
                        , if finished then
                            let
                                slug =
                                    case model.route of
                                        Job s _ ->
                                            s

                                        _ ->
                                            ""
                            in
                            go (Deck slug Route.Optimized) model

                          else
                            Cmd.none
                        ]
                    )

                _ ->
                    ( model, Cmd.none )

        ReportMsg m ->
            case model.page of
                ReportPage report ->
                    let
                        ( next, cmd, out ) =
                            Report.update model.env m report

                        updated =
                            { model | page = ReportPage next }

                        mapped =
                            Cmd.map ReportMsg cmd
                    in
                    case out of
                        Just (Report.Navigate href) ->
                            ( updated, Cmd.batch [ mapped, navigate href ] )

                        Just (Report.OpenSheet sheet) ->
                            ( { updated | sheet = Just sheet }, mapped )

                        Just (Report.Preview cm) ->
                            card cm updated |> Tuple.mapSecond (\c -> Cmd.batch [ c, mapped ])

                        Just (Report.SaveDecklistView v) ->
                            ( { updated | decklistView = v }, Cmd.batch [ mapped, saveDecklistView (Report.decklistViewToString v) ] )

                        Just (Report.ScrollTo id) ->
                            ( updated, Cmd.batch [ mapped, scrollIntoView id ] )

                        Nothing ->
                            ( updated, mapped )

                _ ->
                    ( model, Cmd.none )

        OpenSearch ->
            case model.search of
                Just _ ->
                    ( model, Cmd.none )

                Nothing ->
                    let
                        ( search, cmd ) =
                            CardSearch.init model.env model.decks
                    in
                    ( { model | search = Just search }, Cmd.map SearchMsg cmd )

        SearchMsg m ->
            case model.search of
                Just search ->
                    let
                        ( next, out ) =
                            CardSearch.update m search

                        updated =
                            { model | search = Just next }
                    in
                    case out of
                        Just (CardSearch.Search value) ->
                            ( updated, searchCards value )

                        Just CardSearch.Closed ->
                            ( { model | search = Nothing }, Cmd.none )

                        Just (CardSearch.Preview cm) ->
                            card cm updated

                        Nothing ->
                            ( updated, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        GotHits value ->
            case D.decodeValue CardSearch.hitsDecoder value of
                Ok hits ->
                    update (SearchMsg (CardSearch.GotHits hits)) model

                Err _ ->
                    ( model, Cmd.none )

        SheetMsg m ->
            ( { model | sheet = model.sheet |> Maybe.andThen (Sheet.update m) }, Cmd.none )

        Escape ->
            ( { model | search = Nothing }, Cmd.none ) |> withHowToPlayClosed

        Resized w h ->
            let
                env =
                    model.env
            in
            ( { model | env = { env | viewport = { width = toFloat w, height = toFloat h } } }, Cmd.none )

        MediaChanged value ->
            let
                decoded =
                    D.decodeValue (D.map2 Tuple.pair (D.field "canHover" D.bool) (D.field "isTouch" D.bool)) value
            in
            case decoded of
                Ok ( canHover, isTouch ) ->
                    let
                        env =
                            model.env
                    in
                    ( { model | env = { env | canHover = canHover, isTouch = isTouch } }, Cmd.none )

                Err _ ->
                    ( model, Cmd.none )


{-| Escape also closes How to play, which listens for it like the search does.
-}
withHowToPlayClosed : ( Model, Cmd Msg ) -> ( Model, Cmd Msg )
withHowToPlayClosed ( model, cmd ) =
    case model.page of
        ReportPage report ->
            if report.page.howToPlay then
                let
                    ( next, c2 ) =
                        update (ReportMsg Report.closeHowToPlay) model
                in
                ( next, Cmd.batch [ cmd, c2 ] )

            else
                ( model, cmd )

        _ ->
            ( model, cmd )


card : Card.Msg -> Model -> ( Model, Cmd Msg )
card msg model =
    case msg of
        Card.Open item ->
            ( { model
                | sheet =
                    Just
                        (Sheet.open
                            { src = item.image
                            , alt = item.name
                            , link = { href = item.href, label = "Scryfall ↗" }
                            , wide = False
                            , foil = Nothing
                            }
                        )
              }
            , Cmd.none
            )

        Card.OpenGallery cards ->
            ( { model | sheet = Just (Sheet.gallery cards) }, Cmd.none )

        _ ->
            ( { model | hovers = Card.updateHovers msg model.hovers }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.batch
        [ routeChanged RouteChanged
        , cardHits GotHits
        , mediaChanged MediaChanged
        , Browser.Events.onResize Resized

        -- A card preview's sheet has the keys while it's open; then Escape closes the dialogs under it.
        , case model.sheet of
            Just _ ->
                Browser.Events.onKeyDown (D.map SheetMsg Sheet.keys)

            Nothing ->
                Browser.Events.onKeyDown (Keys.onKeys [ ( "Escape", Escape ) ])
        , case model.page of
            ReportPage report ->
                Sub.map ReportMsg (Report.subscriptions report)

            ProgressPage progress ->
                Sub.map ProgressMsg (Progress.subscriptions progress)

            _ ->
                Sub.none
        ]


view : Model -> Html Msg
view model =
    let
        env =
            model.env

        inner =
            model.route /= Home || model.recognition /= Nothing

        ( body, toggle, overlays ) =
            -- Pages are drawn lazily: a hover preview or the search moving doesn't redraw them.
            case model.page of
                HomePage home ->
                    ( [ Html.map HomeMsg (Html.Lazy.lazy3 Home.view env model.config home) ], Nothing, [] )

                ReviewPage review ->
                    ( [ Html.map ReviewMsg (Html.Lazy.lazy3 Review.view env model.config review) ], Nothing, [] )

                ProgressPage progress ->
                    ( [ Html.map ProgressMsg (Progress.view env progress) ], Nothing, [] )

                ReportPage report ->
                    let
                        route =
                            deckView model.route

                        chrome =
                            Report.chrome env route report.page
                    in
                    ( [ case chrome.note of
                            Just Report.Updating ->
                                p [ class "updating-note", attribute "role" "status" ]
                                    [ span [ class "spinner", attribute "aria-hidden" "true" ] []
                                    , text " Updating the report with your changes…"
                                    ]

                            Just Report.Refreshing ->
                                p [ class "updating-note", attribute "role" "status" ]
                                    [ span [ class "spinner", attribute "aria-hidden" "true" ] []
                                    , text " Updating the rest of the report…"
                                    ]

                            Nothing ->
                                text ""

                      -- Lazy on the page, which the chat isn't part of: typing in the chat, or a reply
                      -- streaming in, doesn't render the report again.
                      , Html.map ReportMsg (Html.Lazy.lazy3 Report.view env route report.page)
                      ]
                        ++ List.map (Html.map ReportMsg) (Report.viewChat env route report)
                    , Maybe.map (Html.map ReportMsg) chrome.toggle
                    , List.map (Html.map ReportMsg) chrome.overlays
                    )
    in
    div [ id "root" ]
        -- Which route is drawn, so the page can set its scroll the moment it is.
        (div [ class "app", attribute "data-mtg-route" (Route.href env.isStatic model.route) ]
            [ header [ class "topbar" ]
                [ if inner then
                    button [ class "back", onClick GoBack, attribute "aria-label" "Back" ]
                        [ Icons.chevronLeft
                        , span [ class "back-label" ]
                            [ text
                                (case model.route of
                                    Run _ ->
                                        "Deck"

                                    _ ->
                                        "Decks"
                                )
                            ]
                        ]

                  else
                    a [ href (Route.href env.isStatic Home), class "brand" ]
                        [ img [ src "./icon-64.png", alt "", width 32, height 32 ] []
                        , text "mtg doc"
                        ]
                , div [ id "topbar-slot", class "topbar-slot" ] (Maybe.withDefault [] (Maybe.map List.singleton toggle))
                , case ( model.config, inner ) of
                    ( Just config, False ) ->
                        span [ class "muted small topbar-meta" ]
                            [ text
                                (if config.llm then
                                    config.model
                                        ++ (if config.webResearch then
                                                " · web research"

                                            else
                                                ""
                                           )

                                 else
                                    "AI disabled (set LLM_API_KEY and LLM_MODEL)"
                                )
                            ]

                    _ ->
                        text ""
                , button [ class "icon topbar-search", attribute "aria-label" "Find a card", title "Find a card (/)", onClick OpenSearch ]
                    [ Icons.search, node "mtg-hotkey" [ on "hotkey" (D.succeed OpenSearch) ] [] ]
                ]
            , main_ [] body
            ]
            :: overlays
            ++ (case model.search of
                    Just search ->
                        [ Html.map SearchMsg (CardSearch.view env search) ]

                    Nothing ->
                        []
               )
            ++ (case model.sheet of
                    Just sheet ->
                        [ Sheet.view SheetMsg sheet ]

                    Nothing ->
                        []
               )
            ++ Card.previews env.viewport model.hovers
        )


deckView : Route -> Route.DeckView
deckView route =
    case route of
        Deck _ v ->
            v

        _ ->
            Route.Current
