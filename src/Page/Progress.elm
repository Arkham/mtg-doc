module Page.Progress exposing (Look, Model, Msg, init, subscriptions, update, view)

{-| An optimizer run, drawn live from the server's trace: every task of its graph on a shared
timeline, the requests each one makes to outside services, and what's happening right now, in
words.
-}

import Api
import Browser.Events
import Dict exposing (Dict)
import Env exposing (Env)
import Html exposing (Html, button, code, div, h1, li, node, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, property, style)
import Html.Events exposing (on, onClick)
import Json.Decode as D
import Process
import Route
import Task
import Time
import Types exposing (..)
import Ui.Attr exposing (class, href)


{-| How long the finished chart stays before the deck opens.
-}
lingerMs : Float
lingerMs =
    4000


{-| How far the clock moves on past the latest trace (the server sends one every second).
-}
driftMs : Float
driftMs =
    1500


type alias Model =
    { jobId : String
    , job : Maybe Job
    , error : Maybe String

    -- The page's clock (ms), and what it read when the latest trace arrived: the chart moves on
    -- between snapshots by itself.
    , now : Float
    , received : Float
    , selected : Maybe String
    , finished : Bool
    , look : Look

    -- Bumped to replay the run on the map.
    , replays : Int

    -- Set once the reader does something here, so the deck doesn't open under them.
    , stay : Bool
    }


{-| Two ways to draw a run: the map, where requests fly to their services, and a timeline.
-}
type Look
    = Map
    | Timeline


type Msg
    = Got (Result String Job)
    | Streamed Job
    | Frame Time.Posix
    | Select String
    | Show Look
    | Replay
    | Linger


init : String -> ( Model, Cmd Msg )
init jobId =
    ( { jobId = jobId, job = Nothing, error = Nothing, now = 0, received = 0, selected = Nothing, finished = False, look = Map, replays = 0, stay = False }
    , Cmd.batch [ Api.job jobId Got, Task.perform Frame Time.now ]
    )


{-| The model after a message, and whether to open the deck now.
-}
update : Msg -> Model -> ( Model, Cmd Msg, Bool )
update msg model =
    case msg of
        Got (Ok job) ->
            arrived job model

        Got (Err e) ->
            ( { model | error = Just e }, Cmd.none, False )

        Streamed job ->
            arrived job model

        Frame time ->
            ( { model | now = toFloat (Time.posixToMillis time) }, Cmd.none, False )

        Select name ->
            ( { model
                | stay = True
                , selected =
                    if model.selected == Just name then
                        Nothing

                    else
                        Just name
              }
            , Cmd.none
            , False
            )

        Show look ->
            ( { model | look = look, stay = True }, Cmd.none, False )

        Replay ->
            ( { model | replays = model.replays + 1, stay = True }, Cmd.none, False )

        Linger ->
            ( model, Cmd.none, isDone model && not model.stay )


isDone : Model -> Bool
isDone model =
    model.job |> Maybe.map (\j -> j.status == JobStatusDone) |> Maybe.withDefault False


arrived : Job -> Model -> ( Model, Cmd Msg, Bool )
arrived job model =
    let
        newer =
            case ( job.trace, model.job |> Maybe.andThen .trace ) of
                ( Just t, Just old ) ->
                    t.elapsed >= old.elapsed

                _ ->
                    True
    in
    if not newer then
        ( model, Cmd.none, False )

    else
        let
            justDone =
                job.status == JobStatusDone && not model.finished
        in
        ( { model | job = Just job, received = model.now, finished = model.finished || justDone }
        , if justDone then
            -- The finished chart, and what it adds up to, before the deck opens.
            Process.sleep lingerMs |> Task.perform (\_ -> Linger)

          else
            Cmd.none
        , False
        )


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.job |> Maybe.map (\j -> j.status == JobStatusRunning) |> Maybe.withDefault True then
        Browser.Events.onAnimationFrame Frame

    else
        Sub.none



-- READING THE TRACE


{-| The run's time now (ms since it started): the latest trace's, moved on by the page's clock
while the run goes on, but only so far past it: the server sends one every second.
-}
elapsed : Model -> Trace -> Bool -> Float
elapsed model trace running =
    if running then
        trace.elapsed + clamp 0 driftMs (model.now - model.received)

    else
        trace.elapsed


{-| The time the chart spans: at least 20s, and a little more than the run so far, so the "now"
line keeps some room ahead of it and the chart rescales smoothly as the run goes on.
-}
domain : Float -> Float
domain t =
    max 20000 (t * 1.12)


isRunning : TraceTask -> Bool
isRunning t =
    t.state == TraceTaskStateRunning


secs : Float -> String
secs ms =
    let
        tenths =
            round (ms / 100)
    in
    String.fromInt (tenths // 10) ++ "." ++ String.fromInt (modBy 10 tenths) ++ " s"


clock : Float -> String
clock ms =
    let
        total =
            floor (ms / 100)

        minutes =
            total // 600

        seconds =
            modBy 600 total // 10
    in
    String.padLeft 2 '0' (String.fromInt minutes) ++ ":" ++ String.padLeft 2 '0' (String.fromInt seconds) ++ "." ++ String.fromInt (modBy 10 total)


{-| A list in words: "a", "a and b", "a, b and c".
-}
sentence : List String -> String
sentence items =
    case List.reverse items of
        [] ->
            ""

        [ only ] ->
            only

        last :: rest ->
            String.join ", " (List.reverse rest) ++ " and " ++ last


serviceName : Service -> String
serviceName s =
    case s of
        ServiceScryfall ->
            "Scryfall"

        ServiceSpellbook ->
            "Commander Spellbook"

        ServiceEdhrec ->
            "EDHREC"

        ServiceModel ->
            "The model"

        ServiceDecisions ->
            "Decisions"


services : List Service
services =
    [ ServiceScryfall, ServiceSpellbook, ServiceEdhrec, ServiceModel, ServiceDecisions ]



-- VIEW


view : Env -> Model -> Html Msg
view env model =
    let
        error =
            case model.job |> Maybe.andThen .error of
                Just e ->
                    if e /= "" then
                        Just e

                    else
                        model.error

                Nothing ->
                    model.error

        stream =
            -- Live while it runs; a finished job has nothing more to say.
            if model.job |> Maybe.map (\j -> j.status == JobStatusRunning) |> Maybe.withDefault True then
                [ node "mtg-event-stream"
                    [ attribute "url" ("/api/jobs/" ++ model.jobId ++ "/events")
                    , attribute "event" "job"
                    , on "data" (D.field "detail" jobDecoder |> D.map Streamed)
                    ]
                    []
                ]

            else
                []
    in
    section [ class "panel run" ]
        ([ header model
         , case model.job |> Maybe.andThen (\j -> Maybe.map (Tuple.pair j) j.trace) of
            Just ( job, trace ) ->
                chart env model job trace

            Nothing ->
                p [ class "muted" ] [ text "Usually under a minute. Your list is already saved in ", code [] [ text ("decks/" ++ (model.job |> Maybe.map .slug |> Maybe.withDefault "…") ++ "/") ], text "." ]
         , if model.job |> Maybe.andThen .trace |> (==) Nothing then
            let
                steps =
                    model.job |> Maybe.map .steps |> Maybe.withDefault []
            in
            ul [ class "steps" ] (List.map step steps)

           else
            text ""
         , case error of
            Just e ->
                p [ class "error" ] [ text e ]

            Nothing ->
                text ""
         , case model.job of
            Just job ->
                if job.status == JobStatusError then
                    Html.a [ href (Route.deckHref env.isStatic job.slug Route.Current) ] [ text "Open deck anyway →" ]

                else
                    text ""

            Nothing ->
                text ""
         ]
            ++ stream
        )


step : JobStep -> Html msg
step s =
    li [ class (jobStepStatusToString s.status) ]
        [ span [ class ("step-icon " ++ jobStepStatusToString s.status), attribute "aria-label" (jobStepStatusToString s.status) ] []
        , div []
            (text s.label
                :: (case s.detail of
                        Just d ->
                            [ div [ class "muted small" ] [ text d ] ]

                        Nothing ->
                            []
                   )
            )
        ]


header : Model -> Html Msg
header model =
    let
        trace =
            model.job |> Maybe.andThen .trace

        status =
            model.job |> Maybe.map .status |> Maybe.withDefault JobStatusRunning

        running =
            status == JobStatusRunning

        t =
            trace |> Maybe.map (\tr -> elapsed model tr running) |> Maybe.withDefault 0

        doing =
            trace |> Maybe.map (.tasks >> List.filter isRunning >> List.map .doing) |> Maybe.withDefault []

        now =
            case ( status, doing ) of
                ( JobStatusDone, _ ) ->
                    if model.stay then
                        "Done."

                    else
                        "Done. Opening your deck…"

                ( JobStatusError, _ ) ->
                    "Something went wrong."

                ( _, [] ) ->
                    "Getting started…"

                ( _, first :: rest ) ->
                    "The doc is " ++ sentence (first :: rest) ++ "."
    in
    div [ class "run-head" ]
        [ div [ class "run-title" ]
            [ span
                [ class
                    (if running then
                        "run-kicker"

                     else
                        "run-kicker finished"
                    )
                ]
                [ text
                    (if running then
                        "Live"

                     else
                        "Finished"
                    )
                ]
            , h1 [] [ text "Optimizing your deck" ]
            ]
        , strong [ class "run-clock", attribute "aria-hidden" "true" ] [ text (clock t) ]
        , p [ class "run-now", attribute "aria-live" "polite" ] [ text now ]
        ]


chart : Env -> Model -> Job -> Trace -> Html Msg
chart env model job trace =
    let
        running =
            job.status == JobStatusRunning

        t =
            elapsed model trace running

        span_ =
            if running then
                domain t

            else
                max 1 trace.elapsed

        x ms =
            clamp 0 100 (ms / span_ * 100)

        byTask =
            List.foldr
                (\r acc ->
                    case r.task of
                        Just name ->
                            Dict.update name (\rs -> Just (r :: Maybe.withDefault [] rs)) acc

                        Nothing ->
                            acc
                )
                Dict.empty
                trace.requests

        tasksByName =
            trace.tasks |> List.map (\r -> ( r.name, r )) |> Dict.fromList
    in
    div [ class "run-chart" ]
        [ looks model.look
        , case model.look of
            Map ->
                runMap model job trace

            Timeline ->
                let
                    critical =
                        if running then
                            []

                        else
                            criticalPath tasksByName trace.tasks

                    related =
                        relations model.selected trace.tasks
                in
                div [] [ legend trace, timeline model x span_ t byTask critical related trace ]
        , detail model t byTask tasksByName
        , if running then
            text ""

          else
            summary env model job trace
        ]


looks : Look -> Html Msg
looks current =
    div [ class "run-looks", attribute "role" "group", attribute "aria-label" "Show the run as" ]
        (List.map
            (\( look, label ) ->
                button
                    [ class "run-look"
                    , attribute "aria-pressed"
                        (if look == current then
                            "true"

                         else
                            "false"
                        )
                    , onClick (Show look)
                    ]
                    [ text label ]
            )
            [ ( Map, "Map" ), ( Timeline, "Timeline" ) ]
        )


runMap : Model -> Job -> Trace -> Html Msg
runMap model job trace =
    node "mtg-run-map"
        ([ property "trace" (encodeTrace trace)
         , attribute "replay" (String.fromInt model.replays)
         , attribute "role" "img"
         , attribute "aria-label" "A map of the run: each step, what it waits for, and its requests to outside services"
         , on "select" (D.field "detail" D.string |> D.map Select)
         ]
            ++ (if job.status == JobStatusRunning then
                    [ attribute "running" "" ]

                else
                    []
               )
            ++ (case model.selected of
                    Just name ->
                        [ attribute "selected" name ]

                    Nothing ->
                        []
               )
        )
        []


timeline :
    Model
    -> (Float -> Float)
    -> Float
    -> Float
    -> Dict String (List TraceRequest)
    -> List String
    -> { needs : List String, feeds : List String }
    -> Trace
    -> Html Msg
timeline model x span_ t byTask critical related trace =
    let
        running =
            model.job |> Maybe.map (\j -> j.status == JobStatusRunning) |> Maybe.withDefault True
    in
    div [ class "run-grid", style "--tick" (String.fromFloat (tickMs span_ / span_ * 100) ++ "%") ]
        [ div [ class "run-axis", attribute "aria-hidden" "true" ] (axis span_)
        , ul [ class "run-rows" ] (List.map (row model x t byTask critical related) trace.tasks)
        , div [ class "run-overlay", attribute "aria-hidden" "true" ]
            [ if running then
                div [ class "run-now-line", style "left" (String.fromFloat (x t) ++ "%") ] []

              else
                text ""
            ]
        ]


{-| The chain of tasks that set how long the run took: from the one that ended last, back through
whatever each waited for longest.
-}
criticalPath : Dict String TraceTask -> List TraceTask -> List String
criticalPath tasksByName tasks =
    let
        latest candidates =
            candidates
                |> List.filterMap (\n -> Dict.get n tasksByName)
                |> List.sortBy (\tk -> negate (Maybe.withDefault 0 tk.end))
                |> List.head

        back task acc =
            case latest task.needs of
                Just before ->
                    back before (task.name :: acc)

                Nothing ->
                    task.name :: acc
    in
    case latest (List.map .name tasks) of
        Just last ->
            back last []

        Nothing ->
            []


{-| For a selected task: the tasks it needs, and the ones that need it.
-}
relations : Maybe String -> List TraceTask -> { needs : List String, feeds : List String }
relations selected tasks =
    case selected of
        Just name ->
            { needs = tasks |> List.filter (\tk -> tk.name == name) |> List.concatMap .needs
            , feeds = tasks |> List.filter (\tk -> List.member name tk.needs) |> List.map .name
            }

        Nothing ->
            { needs = [], feeds = [] }


{-| Each service's requests so far, with a pulse while some are in flight.
-}
legend : Trace -> Html msg
legend trace =
    ul [ class "run-legend", attribute "aria-label" "Requests by service" ]
        (List.map
            (\s ->
                let
                    mine =
                        List.filter (\r -> r.service == s) trace.requests

                    busy =
                        List.any (\r -> r.end == Nothing) mine
                in
                li
                    [ class
                        ("svc-"
                            ++ serviceToString s
                            ++ (if busy then
                                    " busy"

                                else
                                    ""
                               )
                        )
                    ]
                    [ span [ class "svc-dot", attribute "aria-hidden" "true" ] []
                    , text (serviceName s)
                    , strong [] [ text (String.fromInt (List.length mine)) ]
                    ]
            )
            services
        )


{-| The axis's step for a span, so there are three to six ticks.
-}
tickMs : Float -> Float
tickMs span_ =
    if span_ <= 30000 then
        5000

    else if span_ <= 90000 then
        10000

    else if span_ <= 240000 then
        30000

    else
        60000


axis : Float -> List (Html msg)
axis span_ =
    let
        stepMs =
            tickMs span_
    in
    List.range 0 (floor (span_ / stepMs))
        |> List.map
            (\i ->
                let
                    ms =
                        toFloat i * stepMs
                in
                span [ class "run-tick", style "left" (String.fromFloat (ms / span_ * 100) ++ "%") ]
                    [ text (String.fromInt (round (ms / 1000)) ++ "s") ]
            )


row :
    Model
    -> (Float -> Float)
    -> Float
    -> Dict String (List TraceRequest)
    -> List String
    -> { needs : List String, feeds : List String }
    -> TraceTask
    -> Html Msg
row model x t byTask critical related task =
    let
        end =
            Maybe.withDefault t task.end

        state =
            traceTaskStateToString task.state

        duration =
            case task.start of
                Just s ->
                    secs (end - s)

                Nothing ->
                    ""

        flags =
            [ ( "selected", model.selected == Just task.name )
            , ( "needed", List.member task.name related.needs )
            , ( "feeds", List.member task.name related.feeds )
            , ( "critical", List.member task.name critical )
            , ( "dim", model.selected /= Nothing && model.selected /= Just task.name && not (List.member task.name related.needs || List.member task.name related.feeds) )
            ]
                |> List.filter Tuple.second
                |> List.map (\( c, _ ) -> " " ++ c)
                |> String.concat
    in
    li [ class ("run-row " ++ state ++ flags) ]
        [ button
            [ class "run-row-button"
            , onClick (Select task.name)
            , attribute "aria-pressed"
                (if model.selected == Just task.name then
                    "true"

                 else
                    "false"
                )
            ]
            [ span [ class "run-label" ] [ text task.label ]
            , span [ class "run-track" ]
                (case task.start of
                    Just start ->
                        let
                            requests =
                                Dict.get task.name byTask |> Maybe.withDefault []
                        in
                        span
                            [ class "run-bar"
                            , style "left" (String.fromFloat (x start) ++ "%")
                            , style "width" (String.fromFloat (max 0.6 (x end - x start)) ++ "%")
                            ]
                            []
                            :: List.indexedMap (request x t) requests

                    Nothing ->
                        []
                )
            , span [ class "run-duration" ]
                [ text
                    (if duration == "" then
                        "waiting"

                     else
                        duration
                    )
                ]
            ]
        ]


{-| A request inside its task's bar: a thin line in its service's colour, staggered so ones that
overlap don't hide each other.
-}
request : (Float -> Float) -> Float -> Int -> TraceRequest -> Html msg
request x t i r =
    let
        end =
            Maybe.withDefault t r.end
    in
    span
        [ class
            ("run-req svc-"
                ++ serviceToString r.service
                ++ (if r.end == Nothing then
                        " live"

                    else if r.ok == Just False then
                        " failed"

                    else
                        ""
                   )
            )
        , style "left" (String.fromFloat (x r.start) ++ "%")
        , style "width" (String.fromFloat (max 0.4 (x end - x r.start)) ++ "%")
        , style "--lane" (String.fromInt (modBy 3 i))
        ]
        []


{-| What a tapped task did, or what it's waiting for.
-}
detail : Model -> Float -> Dict String (List TraceRequest) -> Dict String TraceTask -> Html Msg
detail model t byTask tasksByName =
    case model.selected |> Maybe.andThen (\n -> Dict.get n tasksByName) of
        Nothing ->
            text ""

        Just task ->
            let
                requests =
                    Dict.get task.name byTask |> Maybe.withDefault []

                labels names =
                    names |> List.filterMap (\n -> Dict.get n tasksByName) |> List.map .label

                feeds =
                    Dict.values tasksByName |> List.filter (\tk -> List.member task.name tk.needs) |> List.map .label

                said =
                    case task.state of
                        TraceTaskStateWaiting ->
                            let
                                waitingFor =
                                    task.needs
                                        |> List.filterMap (\n -> Dict.get n tasksByName)
                                        |> List.filter (\n -> n.state /= TraceTaskStateDone)
                                        |> List.map .label
                            in
                            "Waiting for " ++ sentence waitingFor ++ "."

                        TraceTaskStateRunning ->
                            "Now " ++ task.doing ++ ", " ++ secs (t - Maybe.withDefault t task.start) ++ " so far."

                        TraceTaskStateDone ->
                            "Took " ++ secs (Maybe.withDefault 0 task.end - Maybe.withDefault 0 task.start) ++ "."

                        TraceTaskStateFailed ->
                            "Failed."

                graph =
                    [ if List.isEmpty task.needs then
                        "It starts the run."

                      else
                        "It waits for " ++ sentence (labels task.needs) ++ "."
                    , if List.isEmpty feeds then
                        ""

                      else
                        sentence feeds
                            ++ " "
                            ++ (if List.length feeds == 1 then
                                    "waits"

                                else
                                    "wait"
                               )
                            ++ " for it."
                    ]
                        |> List.filter ((/=) "")
                        |> String.join " "
            in
            div [ class "run-detail", attribute "aria-live" "polite" ]
                (strong [] [ text task.label ]
                    :: p [ class "small" ] [ text (said ++ " " ++ graph) ]
                    :: (if List.isEmpty requests then
                            []

                        else
                            [ ul [ class "run-detail-reqs" ]
                                (List.map
                                    (\r ->
                                        li [ class ("svc-" ++ serviceToString r.service) ]
                                            [ span [ class "svc-dot", attribute "aria-hidden" "true" ] []
                                            , span [] [ strong [] [ text (serviceName r.service) ], text (" " ++ r.what) ]
                                            , span [ class "muted" ]
                                                [ text
                                                    (case r.end of
                                                        Just e ->
                                                            secs (e - r.start)

                                                        Nothing ->
                                                            "in flight"
                                                    )
                                                ]
                                            ]
                                    )
                                    requests
                                )
                            ]
                       )
                )


{-| The finished run in a few lines: how long it took, how much sooner than one step after the
other, and the chain of steps that set the time.
-}
summary : Env -> Model -> Job -> Trace -> Html Msg
summary env model job trace =
    let
        work =
            trace.tasks |> List.map (\tk -> Maybe.withDefault 0 tk.end - Maybe.withDefault 0 tk.start) |> List.sum

        saved =
            work - trace.elapsed
    in
    div [ class "run-summary" ]
        [ p [ class "run-total" ]
            [ strong [] [ text (secs trace.elapsed) ]
            , text
                (if saved > 1000 then
                    ", " ++ secs saved ++ " saved by running steps side by side."

                 else
                    "."
                )
            ]
        , div [ class "run-actions" ]
            [ if job.status == JobStatusDone then
                Html.a [ class "button primary", href (Route.deckHref env.isStatic job.slug Route.Optimized) ]
                    [ text "See the optimized deck" ]

              else
                text ""
            , if model.look == Map then
                button [ class "ghost", onClick Replay ] [ text "Replay the run" ]

              else
                text ""
            ]
        ]
