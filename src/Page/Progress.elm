module Page.Progress exposing (Model, Msg, init, update, view)

import Api
import Env exposing (Env)
import Html exposing (Html, a, code, div, h1, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, style)
import Process
import Route
import Task
import Types exposing (..)
import Ui.Attr exposing (class, href)


type alias Model =
    { jobId : String
    , job : Maybe Job
    , error : Maybe String
    }


type Msg
    = Poll
    | Got (Result String Job)


init : String -> ( Model, Cmd Msg )
init jobId =
    ( { jobId = jobId, job = Nothing, error = Nothing }, Api.job jobId Got )


{-| The model after a message, and whether the job finished (so the report can open).
-}
update : Msg -> Model -> ( Model, Cmd Msg, Bool )
update msg model =
    case msg of
        Poll ->
            ( model, Api.job model.jobId Got, False )

        Got (Ok job) ->
            ( { model | job = Just job }
            , if job.status == JobStatusRunning then
                Process.sleep 1000 |> Task.perform (\_ -> Poll)

              else
                Cmd.none
            , job.status == JobStatusDone
            )

        Got (Err e) ->
            ( { model | error = Just e }, Cmd.none, False )


stepIcon : JobStepStatus -> Html msg
stepIcon status =
    if status == JobStepStatusRunning then
        span [ class "spinner step-icon", attribute "aria-label" "running" ] []

    else
        let
            name =
                jobStepStatusToString status

            glyph =
                case status of
                    JobStepStatusPending ->
                        "○"

                    JobStepStatusDone ->
                        "✓"

                    JobStepStatusError ->
                        "✕"

                    _ ->
                        "–"
        in
        span [ class ("step-icon " ++ name), attribute "aria-label" name ] [ text glyph ]


view : Env -> Model -> Html msg
view env model =
    let
        steps =
            model.job |> Maybe.map .steps |> Maybe.withDefault []

        pct =
            case model.job of
                Just job ->
                    let
                        finished =
                            List.length (List.filter (\s -> s.status == JobStepStatusDone || s.status == JobStepStatusSkipped) steps)
                    in
                    round (toFloat finished / toFloat (List.length job.steps) * 100)

                Nothing ->
                    0

        error =
            case model.job |> Maybe.andThen .error of
                Just e ->
                    if e /= "" then
                        Just e

                    else
                        model.error

                Nothing ->
                    model.error
    in
    section [ class "panel narrow" ]
        [ h1 [] [ text "Optimizing your deck" ]
        , p [ class "muted" ]
            [ text "Usually 30–90 seconds. Your list is already saved in "
            , code [] [ text ("decks/" ++ (model.job |> Maybe.map .slug |> Maybe.withDefault "…") ++ "/") ]
            , text "."
            ]
        , div
            [ class "progress"
            , attribute "role" "progressbar"
            , attribute "aria-valuenow" (String.fromInt pct)
            , attribute "aria-valuemin" "0"
            , attribute "aria-valuemax" "100"
            ]
            [ div [ style "width" (String.fromInt (max 4 pct) ++ "%") ] [] ]
        , ul [ class "steps" ]
            (List.map
                (\s ->
                    li [ class (jobStepStatusToString s.status) ]
                        [ stepIcon s.status
                        , div []
                            (text s.label
                                :: (case s.detail of
                                        Just d ->
                                            if d /= "" then
                                                [ div [ class "muted small" ] [ text d ] ]

                                            else
                                                []

                                        Nothing ->
                                            []
                                   )
                            )
                        ]
                )
                steps
            )
        , case error of
            Just e ->
                p [ class "error" ] [ text e ]

            Nothing ->
                text ""
        , case model.job of
            Just job ->
                if job.status == JobStatusError then
                    a [ href (Route.deckHref env.isStatic job.slug Route.Current) ] [ text "Open deck anyway →" ]

                else
                    text ""

            Nothing ->
                text ""
        ]
