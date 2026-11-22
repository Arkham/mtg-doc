module Page.Home exposing (Mode, Model, Msg, Out(..), Photo, Reading, init, update, view)

import Api
import Dict
import Env exposing (Env)
import File exposing (File)
import File.Select
import Html exposing (Html, a, button, div, figure, h1, h2, img, input, node, p, section, span, strong, text, textarea)
import Html.Attributes exposing (accept, attribute, disabled, height, hidden, multiple, style, value, width)
import Html.Events exposing (on, onClick, onInput, preventDefaultOn)
import Json.Decode as D
import Loadable exposing (Loadable(..))
import Process
import Route
import Site exposing (Site(..))
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, href, placeholder, src, type_)
import Ui.Bracket as Bracket
import Ui.Card as Card
import Ui.Click as Click
import Ui.Icons as Icons
import Ui.Mana as Mana
import Ui.Style exposing (ariaSelected, aura)


type Mode
    = Image
    | TextList


{-| Reading the deck: not asked to; sent (a list is read at once); photos being read, as far as
the job has got; or failed, and why.
-}
type Reading
    = Idle
    | Sending
    | Scanning RecognitionJob
    | Failed String


type alias Photo =
    { file : File, url : String }


type alias Model =
    { decks : Loadable (List DeckSummary)
    , photos : List Photo
    , text : String
    , preferredMode : Mode
    , reading : Reading
    , drag : Bool
    , filter : String
    }


type Msg
    = GotDecks (Result String (List DeckSummary))
    | CardMsg Card.Msg
    | ChoseMode Mode
    | ClickedBrowse
    | ChoseFiles (List File)
    | Dropped (List File)
    | Pasted (List File)
    | GotPhotos (List Photo)
    | ClickedRemovePhoto Int
    | DraggedOver
    | DraggedAway
    | ChangedText String
    | ClickedAnalyze
    | GotStarted (Result String Api.Started)
    | PollDue String
    | GotJob String (Result String RecognitionJob)
    | ChangedFilter String


{-| A deck read from photos or a list, ready for review.
-}
type Out
    = Recognized Recognition (List String)
    | Preview Card.Msg


{-| `decks` is the list as last loaded, drawn at once (coming back keeps the reader's place in it)
while it's fetched again.
-}
init : Env -> Maybe (List DeckSummary) -> ( Model, Cmd Msg )
init env decks =
    ( { decks = Maybe.map Loaded decks |> Maybe.withDefault Loading
      , photos = []
      , text = ""
      , preferredMode = Image
      , reading = Idle
      , drag = False
      , filter = ""
      }
    , Api.decksUnlessKnown env.site decks GotDecks
    )


{-| Photo recognition needs an LLM; fall back to text input when none is configured.
-}
mode : Maybe AppConfig -> Model -> Mode
mode config model =
    case config of
        Just c ->
            if c.llm then
                model.preferredMode

            else
                TextList

        Nothing ->
            model.preferredMode


{-| Whether the deck is being read, by any means.
-}
reading : Model -> Bool
reading model =
    case model.reading of
        Sending ->
            True

        Scanning _ ->
            True

        _ ->
            False


update : Maybe AppConfig -> Msg -> Model -> ( Model, Cmd Msg, Maybe Out )
update config msg model =
    case msg of
        CardMsg m ->
            ( model, Cmd.none, Just (Preview m) )

        GotDecks result ->
            ( { model
                | decks =
                    case ( result, model.decks ) of
                        ( Ok decks, _ ) ->
                            Loaded decks

                        -- A list already on the page stays: it's the decks as they last were.
                        ( Err _, Loaded decks ) ->
                            Loaded decks

                        ( Err e, _ ) ->
                            Unavailable e
              }
            , Cmd.none
            , Nothing
            )

        ChoseMode m ->
            ( { model | preferredMode = m }, Cmd.none, Nothing )

        ClickedBrowse ->
            ( model, File.Select.files [ "image/*" ] (\f fs -> ChoseFiles (f :: fs)), Nothing )

        ChoseFiles files ->
            let
                images =
                    List.filter (\f -> String.startsWith "image/" (File.mime f)) files
            in
            ( model
            , images
                |> List.map (\f -> File.toUrl f |> Task.map (Photo f))
                |> Task.sequence
                |> Task.perform GotPhotos
            , Nothing
            )

        Pasted files ->
            update config (ChoseFiles files) { model | preferredMode = Image }

        Dropped files ->
            update config (ChoseFiles files) { model | drag = False }

        GotPhotos photos ->
            ( { model | photos = model.photos ++ photos }, Cmd.none, Nothing )

        ClickedRemovePhoto i ->
            ( { model | photos = List.take i model.photos ++ List.drop (i + 1) model.photos }, Cmd.none, Nothing )

        DraggedOver ->
            ( { model | drag = True }, Cmd.none, Nothing )

        DraggedAway ->
            ( { model | drag = False }, Cmd.none, Nothing )

        ChangedText t ->
            ( { model | text = t }, Cmd.none, Nothing )

        ClickedAnalyze ->
            let
                m =
                    mode config model
            in
            ( { model | reading = Sending }
            , Api.recognize
                (if m == Image then
                    List.map .file model.photos

                 else
                    []
                )
                (if m == TextList then
                    model.text

                 else
                    ""
                )
                GotStarted
            , Nothing
            )

        GotStarted (Ok (Api.Recognized result)) ->
            done config result model

        GotStarted (Ok (Api.RecognitionStarted id)) ->
            ( model, Api.recognitionJob id (GotJob id), Nothing )

        GotStarted (Err e) ->
            failed e model

        PollDue id ->
            ( model, Api.recognitionJob id (GotJob id), Nothing )

        GotJob id (Ok job) ->
            case job.status of
                RecognitionJobStatusError { error } ->
                    failed error model

                RecognitionJobStatusDone { result } ->
                    done config result model

                RecognitionJobStatusRunning ->
                    ( { model | reading = Scanning job }, Process.sleep 600 |> Task.perform (\_ -> PollDue id), Nothing )

        GotJob _ (Err e) ->
            failed e model

        ChangedFilter f ->
            ( { model | filter = f }, Cmd.none, Nothing )


done : Maybe AppConfig -> Recognition -> Model -> ( Model, Cmd Msg, Maybe Out )
done config result model =
    ( { model | reading = Idle }
    , Cmd.none
    , Just
        (Recognized result
            (if mode config model == Image then
                List.map .url model.photos

             else
                []
            )
        )
    )


failed : String -> Model -> ( Model, Cmd Msg, Maybe Out )
failed e model =
    ( { model | reading = Failed e }, Cmd.none, Nothing )


welcome : Env -> Loadable (List DeckSummary) -> Html msg
welcome env decks =
    let
        examined =
            decks |> Loadable.toMaybe |> Maybe.map (List.filter .hasReport >> List.length) |> Maybe.withDefault 0
    in
    section [ class "home-hero" ]
        [ div [ class "home-hero-text" ]
            [ span [ class "hero-role" ]
                [ span [ attribute "aria-hidden" "true" ] [ text "♛" ], text " The mtg doc" ]
            , h1 [] [ text "The doc will see your deck now." ]
            , p []
                [ text
                    (if env.site == Published then
                        "Check-ups for Commander decks: what each one does today, its bracket and combos, and the swaps the doc prescribes."

                     else
                        "Snap a photo of your Commander deck. The doc reads every card, works out its bracket and prescribes swaps that fit your budget."
                    )
                ]
            , if examined > 0 then
                p [ class "home-hero-count" ]
                    [ text
                        (String.fromInt examined
                            ++ " "
                            ++ (if examined == 1 then
                                    "deck"

                                else
                                    "decks"
                               )
                            ++ " examined so far"
                        )
                    ]

              else
                text ""
            ]
        , div [ class "home-hero-doc", attribute "aria-hidden" "true" ]
            [ img [ src "./doc.webp", alt "", width 360, height 360 ] [] ]
        ]


deckGallery : Env -> String -> List DeckSummary -> Html Msg
deckGallery env filter decks =
    let
        shown =
            List.filter
                (\d -> String.contains (String.toLower filter) (String.toLower (slugToString d.slug ++ " " ++ String.join " " d.commanders)))
                decks
    in
    section []
        [ div [ class "section-head" ]
            [ h2 [ class "home-section-title" ]
                [ text
                    (if env.site == Published then
                        "Decks"

                     else
                        "Your decks"
                    )
                ]
            , if List.length decks > 6 then
                input
                    [ type_ "search"
                    , class "deck-filter"
                    , placeholder "Search commanders…"
                    , value filter
                    , Ui.Attr.valueAttr filter
                    , onInput ChangedFilter
                    ]
                    []

              else
                text ""
            ]
        , if List.isEmpty decks then
            div [ class "empty" ]
                [ p [] [ text "No decks yet." ]
                , if env.site == Published then
                    p [ class "muted small" ] [ text "Run pnpm build:static after analyzing a deck." ]

                  else
                    text ""
                ]

          else
            text ""
        , div [ class "deck-grid" ] (List.map (deckCard env) shown)
        ]


{-| The whole card opens the deck, through a link stretched over it; the commanders' names over
the art preview their cards, so a reader can see what a deck does before opening it.
-}
deckCard : Env -> DeckSummary -> Html Msg
deckCard env d =
    let
        title =
            if List.isEmpty d.commanders then
                slugToString d.slug

            else
                String.join " + " d.commanders
    in
    div [ class "deck-card", aura d.colorIdentity ]
        [ a [ class "deck-card-link", href (Route.deckHref env.site d.slug Route.Current), attribute "aria-label" title ] []

        -- What the deck's page loads first: its report, the list it copies, the commanders' cards.
        , node "mtg-prefetch"
            [ attribute "urls" (Api.deckUrl env.site d.slug ++ " " ++ Api.fileUrl env.site d.slug "optimized.txt")
            , attribute "images"
                (d.commanderPreviews
                    |> Maybe.map (Dict.values >> List.filterMap .image >> String.join " ")
                    |> Maybe.withDefault ""
                )
            ]
            []
        , div [ class "deck-art" ]
            [ case d.image of
                Just image ->
                    img [ src image, alt "", attribute "loading" "lazy" ] []

                Nothing ->
                    span [] [ text "🃏" ]
            , div [ class "deck-art-top" ]
                [ Mana.colorIdentity env.base 20 d.colorIdentity
                , case d.bracket of
                    Just b ->
                        Bracket.badge b "sm"

                    Nothing ->
                        text ""
                ]
            , strong [ class "deck-art-name" ]
                (if List.isEmpty d.commanders then
                    [ text (slugToString d.slug) ]

                 else
                    let
                        ctx =
                            { index = Maybe.withDefault Dict.empty d.commanderPreviews
                            , gallery = Nothing
                            , canHover = env.canHover
                            , lift = CardMsg
                            }
                    in
                    Card.list ctx " + " d.commanders
                )
            ]
        , div [ class "deck-card-body" ]
            [ span [ class "muted small" ]
                [ text
                    (if d.hasReport then
                        [ Maybe.map (\b -> "Bracket " ++ String.fromInt (bracketToInt b)) d.bracket
                        , Maybe.map (\n -> String.fromInt n ++ " lands") d.landCount
                        , Maybe.map (\p -> "$" ++ String.fromInt (round p)) d.priceUsd
                        ]
                            |> List.filterMap identity
                            |> String.join " · "

                     else
                        "Not analyzed yet"
                    )
                ]
            , case d.swapCount of
                Just n ->
                    if n /= 0 then
                        span [ class "deck-suggest" ]
                            [ img [ src "./icon-64.png", alt "", width 18, height 18 ] []
                            , text
                                (String.fromInt n
                                    ++ " suggested "
                                    ++ (if n == 1 then
                                            "swap"

                                        else
                                            "swaps"
                                       )
                                    ++ (case d.targetBracket of
                                            Just t ->
                                                " for bracket " ++ String.fromInt (bracketToInt t)

                                            Nothing ->
                                                ""
                                       )
                                )
                            ]

                    else
                        text ""

                Nothing ->
                    text ""
            ]
        ]


filesDecoder : D.Decoder (List File)
filesDecoder =
    D.list File.decoder


view : Env -> Maybe AppConfig -> Model -> Html Msg
view env config model =
    div [ class "stack" ]
        [ welcome env model.decks
        , if env.site == Published then
            text ""

          else
            let
                m =
                    mode config model

                canSubmit =
                    case m of
                        Image ->
                            not (List.isEmpty model.photos)

                        TextList ->
                            String.trim model.text /= ""
            in
            section [ class "panel analyze" ]
                [ div [ class "section-head" ]
                    [ h2 [ class "home-section-title" ] [ text "Analyze a deck" ]
                    , div [ class "segmented", attribute "role" "tablist" ]
                        [ button
                            [ attribute "role" "tab"
                            , ariaSelected (m == Image)
                            , onClick (ChoseMode Image)
                            , disabled (config |> Maybe.map (not << .llm) |> Maybe.withDefault False)
                            ]
                            [ text "Photo" ]
                        , button [ attribute "role" "tab", ariaSelected (m == TextList), onClick (ChoseMode TextList) ] [ text "Text list" ]
                        ]
                    ]
                , case m of
                    Image ->
                        dropzone env model

                    TextList ->
                        textarea
                            [ class "decklist"
                            , placeholder "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n1 Arcane Signet\n..."
                            , value model.text
                            , onInput ChangedText
                            ]
                            []
                , case model.reading of
                    Scanning progress ->
                        div [ class "scan-progress", attribute "role" "status" ]
                            [ div [ class "row between small" ]
                                [ span [] [ text progress.phase ]
                                , span [ class "muted" ]
                                    [ text
                                        (if progress.total > 1 then
                                            String.fromInt progress.done ++ " / " ++ String.fromInt progress.total

                                         else
                                            ""
                                        )
                                    ]
                                ]
                            , div [ class "progress" ]
                                [ div [ style "width" (String.fromFloat (max 4 (toFloat progress.done / toFloat (max 1 progress.total) * 100)) ++ "%") ] [] ]
                            , span [ class "muted small" ]
                                [ text "Reading the photo several times in overlapping crops, then double-checking anything only one pass saw." ]
                            ]

                    Failed e ->
                        p [ class "error" ] [ text e ]

                    _ ->
                        text ""
                , div [ class "row end" ]
                    [ button [ class "primary big", disabled (not canSubmit || reading model), onClick ClickedAnalyze ]
                        (if reading model then
                            [ span [ class "spinner", attribute "aria-hidden" "true" ] []
                            , text
                                (if m == Image then
                                    "Reading cards…"

                                 else
                                    "Checking cards…"
                                )
                            ]

                         else
                            [ text "Analyze deck" ]
                        )
                    ]
                , node "mtg-paste" [ on "images" (D.map Pasted (D.at [ "detail" ] filesDecoder)) ] []
                ]
        , case model.decks of
            Loading ->
                div [ class "loading" ] [ span [ class "spinner", attribute "aria-hidden" "true" ] [], text " Loading decks…" ]

            Unavailable e ->
                p [ class "error" ] [ text ("Couldn't load the decks: " ++ e) ]

            Loaded decks ->
                if not (List.isEmpty decks) || env.site == Published then
                    deckGallery env model.filter decks

                else
                    text ""
        ]


dropzone : Env -> Model -> Html Msg
dropzone env model =
    div
        [ class
            ("dropzone "
                ++ (if model.drag then
                        "drag"

                    else
                        ""
                   )
                ++ " "
                ++ (if List.isEmpty model.photos then
                        ""

                    else
                        "has-files"
                   )
            )
        , on "click" (Click.unlessWithin { root = "dropzone", inside = [ "figure" ] } ClickedBrowse)
        , preventDefaultOn "dragover" (D.succeed ( DraggedOver, True ))
        , on "dragleave" (D.succeed DraggedAway)
        , preventDefaultOn "drop" (D.map (\fs -> ( Dropped fs, True )) (D.at [ "dataTransfer", "files" ] filesDecoder))
        ]
        [ input
            [ type_ "file"
            , accept "image/*"
            , multiple True
            , hidden True
            , on "change" (D.map ChoseFiles (D.at [ "target", "files" ] filesDecoder))
            ]
            []
        , if List.isEmpty model.photos then
            div [ class "dropzone-empty" ]
                [ div [ class "dropzone-icon", attribute "aria-hidden" "true" ] [ text "📷" ]
                , strong []
                    [ text
                        (if env.isTouch then
                            "Take a photo or choose from your library"

                         else
                            "Drop deck photos here"
                        )
                    ]
                , span [ class "muted small" ]
                    [ text
                        ((if env.isTouch then
                            ""

                          else
                            "or click to browse · paste a screenshot with ⌘V · "
                         )
                            ++ "Lay cards out so the names are readable; several photos are fine."
                        )
                    ]
                ]

          else
            div [ class "thumbs" ]
                (List.indexedMap
                    (\i photo ->
                        figure []
                            [ img [ src photo.url, alt (File.name photo.file) ] []
                            , button [ class "icon remove", attribute "aria-label" "Remove photo", onClick (ClickedRemovePhoto i) ] [ Icons.close ]
                            ]
                    )
                    model.photos
                    ++ [ button [ class "add-more" ] [ text "+ Add photo" ] ]
                )
        ]
