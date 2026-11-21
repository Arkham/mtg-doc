module Page.Progress exposing (Look, Model, Msg, Playback, Source, init, initSaved, subscriptions, update, view)

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
import Html.Lazy
import Json.Decode as D
import Process
import Route
import RunCopy
import Svg
import Svg.Attributes as SA
import Task
import Time
import Types exposing (..)
import Ui.Attr exposing (class, href, title, type_)
import Ui.Icons as Icons


{-| How long the finished chart stays before the deck opens.
-}
lingerMs : Float
lingerMs =
    4000


{-| How long past its end a run plays, so the map can finish: its last comets come home, then all
but the golden path fades (`OUTRO_*` in src/run-map.ts).
-}
outroMs : Float
outroMs =
    1200


{-| How far the clock moves on past the latest trace (the server sends one every second).
-}
driftMs : Float
driftMs =
    1500


{-| How far behind the run a live view plays: the server's events arrive before the moment they
describe is shown, so everything moves from where it started instead of popping in late.
-}
delayMs : Float
delayMs =
    300


{-| Where the run comes from: one going on now (a job), or a deck's saved last run.
-}
type Source
    = Live String
    | Saved String


{-| A replay's playhead: where it is in the run (ms), whether it's moving, and how fast.
-}
type alias Playback =
    { at : Float
    , playing : Bool
    , speed : Float
    }


type alias Model =
    { source : Source
    , job : Maybe Job
    , run : Maybe RunRecord
    , error : Maybe String

    -- The page's clock (ms); when, on it, the run started (as best the events tell); the moment
    -- of the run shown live, which moves on every frame and never goes back; and the latest
    -- run time the server reported.
    , now : Float
    , origin : Maybe Float
    , liveAt : Float
    , reported : Float
    , selected : Maybe String
    , finished : Bool
    , look : Look
    , playback : Maybe Playback

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
    | GotRun (Result String RunRecord)
    | Streamed Job
    | Frame Time.Posix
    | Select String
    | Show Look
    | Replay
    | Toggle
    | Seek Float
    | Nudge Float
    | Speed Float
    | Key String
    | Linger


defaultSpeed : Float
defaultSpeed =
    2


speeds : List Float
speeds =
    [ 1, 2, 4 ]


blank : Source -> Model
blank source =
    { source = source, job = Nothing, run = Nothing, error = Nothing, now = 0, origin = Nothing, liveAt = 0, reported = 0, selected = Nothing, finished = False, look = Map, playback = Nothing, stay = False }


{-| A run going on now.
-}
init : String -> ( Model, Cmd Msg )
init jobId =
    ( blank (Live jobId)
    , Cmd.batch [ Api.job jobId Got, Task.perform Frame Time.now ]
    )


{-| A deck's saved last run, replaying from the start.
-}
initSaved : Env -> String -> ( Model, Cmd Msg )
initSaved env slug =
    ( blank (Saved slug)
    , Cmd.batch [ Api.run env.isStatic slug GotRun, Task.perform Frame Time.now ]
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

        GotRun (Ok run) ->
            ( { model | run = Just run, playback = Just { at = 0, playing = True, speed = defaultSpeed } }, Cmd.none, False )

        GotRun (Err e) ->
            ( { model | error = Just e }, Cmd.none, False )

        Streamed job ->
            arrived job model

        Frame time ->
            let
                now =
                    toFloat (Time.posixToMillis time)
            in
            ( { model
                | now = now
                , liveAt = liveClock model now
                , playback =
                    model.playback
                        |> Maybe.map
                            (\pb ->
                                if pb.playing then
                                    let
                                        -- A frame after the tab was away doesn't jump the replay ahead.
                                        dt =
                                            clamp 0 100 (now - model.now)
                                    in
                                    seekTo model { pb | at = pb.at + dt * pb.speed }

                                else
                                    pb
                            )
              }
            , Cmd.none
            , False
            )

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
            let
                speed =
                    model.playback |> Maybe.map .speed |> Maybe.withDefault defaultSpeed
            in
            ( { model | stay = True, playback = Just { at = 0, playing = True, speed = speed } }, Cmd.none, False )

        Toggle ->
            ( { model
                | stay = True
                , playback =
                    model.playback
                        |> Maybe.map
                            (\pb ->
                                if pb.playing then
                                    { pb | playing = False }

                                else if pb.at >= runLength model then
                                    -- At the end, playing again starts over.
                                    { pb | at = 0, playing = True }

                                else
                                    { pb | playing = True }
                            )
              }
            , Cmd.none
            , False
            )

        Seek at ->
            ( { model | stay = True, playback = model.playback |> Maybe.map (\pb -> seekTo model { pb | at = at }) }, Cmd.none, False )

        Nudge by ->
            ( { model | stay = True, playback = model.playback |> Maybe.map (\pb -> seekTo model { pb | at = pb.at + by, playing = False }) }, Cmd.none, False )

        Speed speed ->
            ( { model | playback = model.playback |> Maybe.map (\pb -> { pb | speed = speed }) }, Cmd.none, False )

        Key key ->
            case key of
                "Space" ->
                    update Toggle model

                "k" ->
                    update Toggle model

                "ArrowLeft" ->
                    update (Nudge -1000) model

                "ArrowRight" ->
                    update (Nudge 1000) model

                "," ->
                    update (Nudge -100) model

                "." ->
                    update (Nudge 100) model

                "Home" ->
                    update (Seek 0) model

                _ ->
                    ( model, Cmd.none, False )

        Linger ->
            ( model, Cmd.none, isDone model && not model.stay )


{-| The playhead kept inside the run; reaching the end stops it there.
-}
seekTo : Model -> Playback -> Playback
seekTo model pb =
    let
        length =
            runLength model

        at =
            clamp 0 length pb.at
    in
    { pb | at = at, playing = pb.playing && at < length }


{-| How far a playhead goes: the run, and its outro.
-}
runLength : Model -> Float
runLength model =
    fullTrace model |> Maybe.map (\t -> t.elapsed + outroMs) |> Maybe.withDefault 0


fullTrace : Model -> Maybe Trace
fullTrace model =
    case model.run of
        Just run ->
            Just run.trace

        Nothing ->
            model.job |> Maybe.andThen .trace


{-| How the run went (or is going), live or saved.
-}
runStatus : Model -> JobStatus
runStatus model =
    case ( model.run, model.job ) of
        ( Just run, _ ) ->
            if run.status == RunRecordStatusDone then
                JobStatusDone

            else
                JobStatusError

        ( Nothing, Just job ) ->
            job.status

        ( Nothing, Nothing ) ->
            JobStatusRunning


isLive : Model -> Bool
isLive model =
    runStatus model == JobStatusRunning && model.run == Nothing


isDone : Model -> Bool
isDone model =
    model.job |> Maybe.map (\j -> j.status == JobStatusDone) |> Maybe.withDefault False


slugOf : Model -> String
slugOf model =
    case model.source of
        Saved slug ->
            slug

        Live _ ->
            model.job |> Maybe.map .slug |> Maybe.withDefault ""


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
        ( { model
            | job = Just job
            , finished = model.finished || justDone

            -- The event that took the least time to arrive tells best when the run started.
            , origin =
                case job.trace of
                    Just t ->
                        Just (min (Maybe.withDefault (model.now - t.elapsed) model.origin) (model.now - t.elapsed))

                    Nothing ->
                        model.origin
            , reported = job.trace |> Maybe.map .elapsed |> Maybe.withDefault model.reported
          }
        , if justDone then
            -- The finished chart, and what it adds up to, before the deck opens.
            Process.sleep lingerMs |> Task.perform (\_ -> Linger)

          else
            Cmd.none
        , False
        )


{-| The live moment at the page's time `now`: the run's time a little behind the server's, moving
on at the frame's pace, and catching up gently (never jumping back) when an event shows it's
behind. It stops at the end of the run, or a little past the latest event while it goes on.
-}
liveClock : Model -> Float -> Float
liveClock model now =
    case ( model.origin, fullTrace model ) of
        ( Just origin, Just trace ) ->
            let
                limit =
                    if isLive model then
                        model.reported + driftMs

                    else
                        trace.elapsed + outroMs

                target =
                    min limit (now - origin - delayMs)

                gap =
                    target - model.liveAt
            in
            if gap > 2000 then
                target

            else if gap > 0 then
                let
                    dt =
                        max 0 (now - model.now)
                in
                model.liveAt + min gap (dt * 1.25)

            else
                model.liveAt

        _ ->
            model.liveAt


{-| Whether a live view still has a moment to move on to.
-}
catchingUp : Model -> Bool
catchingUp model =
    model.playback == Nothing && model.run == Nothing && (fullTrace model |> Maybe.map (\t -> model.liveAt < t.elapsed + outroMs) |> Maybe.withDefault False)


subscriptions : Model -> Sub Msg
subscriptions model =
    if isLive model || catchingUp model || (model.playback |> Maybe.map .playing |> Maybe.withDefault False) then
        Browser.Events.onAnimationFrame Frame

    else
        Sub.none



-- READING THE TRACE


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


serviceName : Service -> String
serviceName s =
    case s of
        ServiceScryfall ->
            "Scryfall"

        ServiceSpellbook ->
            "Spellbook"

        ServiceEdhrec ->
            "EDHREC"

        ServiceModel ->
            "LLM"

        ServiceDecisions ->
            "Decisions"


services : List Service
services =
    [ ServiceScryfall, ServiceSpellbook, ServiceEdhrec, ServiceModel, ServiceDecisions ]


{-| The run as it stood at a moment: what had started, what had ended, what was in flight. A
replay draws this, so every view of it shows that moment.
-}
traceAt : Float -> Trace -> Trace
traceAt t trace =
    let
        past m =
            case m of
                Just v ->
                    if v <= t then
                        Just v

                    else
                        Nothing

                Nothing ->
                    Nothing
    in
    { elapsed = t
    , tasks =
        List.map
            (\task ->
                let
                    start =
                        past task.start

                    end =
                        past task.end
                in
                { task
                    | start = start
                    , end = end
                    , state =
                        case ( start, end ) of
                            ( Nothing, _ ) ->
                                TraceTaskStateWaiting

                            ( Just _, Nothing ) ->
                                TraceTaskStateRunning

                            ( Just _, Just _ ) ->
                                if task.state == TraceTaskStateFailed then
                                    TraceTaskStateFailed

                                else
                                    TraceTaskStateDone
                }
            )
            trace.tasks
    , requests =
        trace.requests
            |> List.filter (\r -> r.start <= t)
            |> List.map
                (\r ->
                    if past r.end == Nothing then
                        { r | end = Nothing, ok = Nothing }

                    else
                        r
                )
    }


{-| The moment shown: the playhead in a replay, now in a live run.
-}
moment : Model -> Trace -> Float
moment model trace =
    case model.playback of
        Just pb ->
            pb.at

        Nothing ->
            if model.run == Nothing then
                min (trace.elapsed + outroMs) model.liveAt

            else
                trace.elapsed


{-| Whether the moment shown is the run's end, with everything it did.
-}
atEnd : Model -> Trace -> Bool
atEnd model trace =
    not (isLive model) && moment model trace >= trace.elapsed



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
            case model.source of
                Live jobId ->
                    if isLive model then
                        [ node "mtg-event-stream"
                            [ attribute "url" ("/api/jobs/" ++ jobId ++ "/events")
                            , attribute "event" "job"
                            , on "data" (D.field "detail" jobDecoder |> D.map Streamed)
                            ]
                            []
                        ]

                    else
                        []

                Saved _ ->
                    []
    in
    section [ class "panel run" ]
        ([ header model
         , case fullTrace model of
            Just trace ->
                chart env model trace

            Nothing ->
                case model.source of
                    Live _ ->
                        p [ class "muted" ] [ text "Usually under a minute. Your list is already saved in ", code [] [ text ("decks/" ++ slugOf model ++ "/") ], text "." ]

                    Saved _ ->
                        text ""
         , case ( model.job, fullTrace model ) of
            ( Just job, Nothing ) ->
                ul [ class "steps" ] (List.map step job.steps)

            _ ->
                text ""
         , case error of
            Just e ->
                p [ class "error" ] [ text e ]

            Nothing ->
                text ""
         , if model.job /= Nothing && runStatus model == JobStatusError then
            Html.a [ href (Route.deckHref env.isStatic (slugOf model) Route.Current) ] [ text "Open deck anyway →" ]

           else
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


{-| What the pill over the map says at the moment shown: what the step started last is up to,
and how many more run beside it.
-}
nowSentence : Model -> Trace -> String
nowSentence model trace =
    let
        t =
            moment model trace

        running =
            traceAt t trace
                |> .tasks
                |> List.filter isRunning
                |> List.sortBy (\task -> negate (Maybe.withDefault 0 task.start))
    in
    case ( atEnd model trace, runStatus model, running ) of
        ( True, JobStatusDone, _ ) ->
            "GG!"

        ( True, JobStatusError, _ ) ->
            "Took a misstep"

        ( _, _, [] ) ->
            if t == 0 then
                "Shuffling up…"

            else
                "Thinking…"

        ( _, _, latest :: others ) ->
            RunCopy.pill latest.name
                ++ "…"
                ++ (if List.isEmpty others then
                        ""

                    else
                        " +" ++ String.fromInt (List.length others)
                   )


header : Model -> Html Msg
header model =
    let
        ( kicker, kickerClass ) =
            case model.playback of
                Just pb ->
                    ( if pb.playing then
                        "Replay"

                      else
                        "Paused"
                    , "run-kicker replay"
                    )

                Nothing ->
                    if isLive model then
                        ( "Live", "run-kicker" )

                    else
                        ( "Finished", "run-kicker finished" )
    in
    div [ class "run-head" ]
        [ div [ class "run-title" ]
            [ span [ class kickerClass ] [ text kicker ]
            , h1 []
                [ text
                    (case model.source of
                        Live _ ->
                            "Optimizing your deck"

                        Saved _ ->
                            "How the doc optimized this deck"
                    )
                ]
            ]
        , if fullTrace model == Nothing then
            text ""

          else
            looks model.look
        ]


chart : Env -> Model -> Trace -> Html Msg
chart env model full =
    let
        live =
            isLive model

        t =
            moment model full

        ended =
            atEnd model full

        span_ =
            if live then
                domain t

            else
                max 1 full.elapsed

        x ms =
            clamp 0 100 (ms / span_ * 100)
    in
    div [ class "run-chart" ]
        [ div [ class "run-stage" ]
            [ -- Over the corner of the map or timeline: what the doc is doing.
              div [ class "run-overlays" ]
                [ p [ class "run-pill", attribute "aria-live" "polite" ] [ text (nowSentence model full) ] ]
            , case model.look of
                Map ->
                    runMap model full

                Timeline ->
                    let
                        -- Live too: the run is shown a little behind the events, which may already say what's next.
                        trace =
                            traceAt t full

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

                        critical =
                            if ended then
                                let
                                    tasksByName =
                                        trace.tasks |> List.map (\r -> ( r.name, r )) |> Dict.fromList
                                in
                                criticalPath tasksByName trace.tasks

                            else
                                []

                        related =
                            relations model.selected trace.tasks
                    in
                    div [ class "run-timeline" ] [ legend trace, timeline model x span_ t byTask critical related trace ]
            ]
        , -- A replay has its own controls and its own clock.
          if ended && model.playback == Nothing then
            summary env model full

          else
            text ""
        , case model.playback of
            Just pb ->
                player pb full

            Nothing ->
                text ""
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


runMap : Model -> Trace -> Html Msg
runMap model trace =
    node "mtg-run-map"
        ([ property "trace" (encodeTrace trace)
         , attribute "role" "img"
         , attribute "aria-label" "A map of the run: each step, what it waits for, and its requests to outside services"
         , on "select" (D.field "detail" D.string |> D.map Select)
         ]
            ++ (if isLive model then
                    [ attribute "running" "" ]

                else
                    []
               )
            ++ [ attribute "at" (String.fromFloat (moment model trace)) ]
            ++ (case model.selected of
                    Just name ->
                        [ attribute "selected" name ]

                    Nothing ->
                        []
               )
        )
        []


{-| A replay's controls: play and pause, step, speed, and a strip of the whole run to scrub,
showing how many requests each service had in flight.
-}
player : Playback -> Trace -> Html Msg
player pb trace =
    let
        length =
            max 1 trace.elapsed

        -- Where the thumb's centre sits for a fraction of the run: a range input keeps its thumb
        -- inside the track, half a thumb from either end.
        along f =
            "calc(8px + (100% - 16px) * " ++ String.fromFloat (clamp 0 1 f) ++ ")"

        iconButton label hint msg glyph =
            button [ class "run-ctl", attribute "aria-label" label, title hint, onClick msg ] [ glyph ]
    in
    div [ class "run-player" ]
        [ node "mtg-keys"
            [ attribute "keys" "Space k ArrowLeft ArrowRight , . Home"
            , on "key" (D.field "detail" D.string |> D.map Key)
            ]
            []
        , div [ class "run-ctls" ]
            [ iconButton "Back to the start" "Home" (Seek 0) Icons.restart
            , iconButton "Back a second" "←" (Nudge -1000) Icons.back
            , button
                [ class "run-ctl run-play"
                , attribute "aria-label"
                    (if pb.playing then
                        "Pause"

                     else
                        "Play"
                    )
                , title "Space"
                , onClick Toggle
                ]
                [ if pb.playing then
                    Icons.pause

                  else
                    Icons.play
                ]
            , iconButton "On a second" "→" (Nudge 1000) Icons.forward
            , span [ class "run-time" ] [ text (clock (min pb.at trace.elapsed)), span [ class "muted" ] [ text (" / " ++ clock trace.elapsed) ] ]
            , div [ class "run-speeds", attribute "role" "group", attribute "aria-label" "Speed" ]
                (List.map
                    (\sp ->
                        button
                            [ class "run-speed"
                            , attribute "aria-pressed"
                                (if sp == pb.speed then
                                    "true"

                                 else
                                    "false"
                                )
                            , onClick (Speed sp)
                            ]
                            [ text (String.fromFloat sp ++ "×") ]
                    )
                    speeds
                )
            ]
        , div [ class "run-scrub" ]
            [ Html.Lazy.lazy histogram trace
            , div [ class "run-scrub-played", style "width" (along (pb.at / length)) ] []
            , Html.input
                [ type_ "range"
                , Ui.Attr.min "0"
                , Ui.Attr.max (String.fromFloat length)
                , attribute "step" "any"
                , Html.Attributes.value (String.fromFloat (min pb.at trace.elapsed))
                , attribute "aria-label" "Moment in the run"

                -- All the way to the end is the end of the outro, so a still there is a clean one.
                , Html.Events.onInput
                    (String.toFloat
                        >> Maybe.withDefault 0
                        >> (\v ->
                                if v >= trace.elapsed then
                                    trace.elapsed + outroMs

                                else
                                    v
                           )
                        >> Seek
                    )
                ]
                []
            ]
        ]


{-| How many requests each service had in flight across the run, stacked.
-}
histogram : Trace -> Html msg
histogram trace =
    let
        bins =
            120

        length =
            max 1 trace.elapsed

        counts =
            List.map
                (\svc ->
                    let
                        mine =
                            List.filter (\r -> r.service == svc) trace.requests
                    in
                    ( svc
                    , List.map
                        (\i ->
                            let
                                t =
                                    (toFloat i + 0.5) / bins * length
                            in
                            mine |> List.filter (\r -> r.start <= t && t < Maybe.withDefault length r.end) |> List.length
                        )
                        (List.range 0 (bins - 1))
                    )
                )
                services

        totals =
            List.foldl (\( _, cs ) acc -> List.map2 (+) cs acc) (List.repeat bins 0) counts

        peak =
            toFloat (Maybe.withDefault 1 (List.maximum (1 :: totals)))

        bars =
            List.foldl
                (\( svc, cs ) ( base, acc ) ->
                    ( List.map2 (+) base cs
                    , acc
                        ++ List.concat
                            (List.map3
                                (\i below n ->
                                    if n == 0 then
                                        []

                                    else
                                        [ Svg.rect
                                            [ SA.x (String.fromInt i)
                                            , SA.y (String.fromFloat (30 - toFloat (below + n) / peak * 30))
                                            , SA.width "0.8"
                                            , SA.height (String.fromFloat (toFloat n / peak * 30))
                                            , SA.class ("svc-" ++ serviceToString svc)
                                            ]
                                            []
                                        ]
                                )
                                (List.range 0 (bins - 1))
                                base
                                cs
                            )
                    )
                )
                ( List.repeat bins 0, [] )
                counts
                |> Tuple.second
    in
    Svg.svg
        [ SA.class "run-histogram"
        , SA.viewBox ("0 0 " ++ String.fromInt bins ++ " 30")
        , SA.preserveAspectRatio "none"
        , attribute "aria-hidden" "true"
        ]
        bars


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
    div [ class "run-grid", style "--tick" (String.fromFloat (tickMs span_ / span_ * 100) ++ "%") ]
        [ div [ class "run-axis", attribute "aria-hidden" "true" ] (axis span_)
        , ul [ class "run-rows" ] (List.map (row model x t byTask critical related) trace.tasks)
        , div [ class "run-overlay", attribute "aria-hidden" "true" ]
            [ if isLive model || model.playback /= Nothing then
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
            [ span [ class "run-label" ] [ text (RunCopy.label task.name) ]
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


{-| The finished run in a line, with where to go from it.
-}
summary : Env -> Model -> Trace -> Html Msg
summary env model trace =
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
            [ if runStatus model == JobStatusDone then
                Html.a [ class "button primary", href (Route.deckHref env.isStatic (slugOf model) Route.Optimized) ]
                    [ text "See the optimized deck" ]

              else
                text ""
            , button [ class "ghost", onClick Replay ] [ text "Replay the run" ]
            ]
        ]
