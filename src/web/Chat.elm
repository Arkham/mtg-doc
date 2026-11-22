module Chat exposing (Asking, Config, Model, Msg, Out(..), init, reload, subscriptions, update, view)

{-| Sidebar for asking questions about a deck and making edits through conversation.
-}

import Api
import Browser.Events
import Dict exposing (Dict)
import Env exposing (Env)
import Format exposing (toFixed)
import Html exposing (Html, a, aside, button, div, form, header, img, li, node, p, span, strong, text, textarea, ul)
import Html.Attributes exposing (attribute, disabled, height, property, rows, value, width)
import Html.Events exposing (on, onClick, onInput, preventDefaultOn)
import Json.Decode as D
import Json.Encode as E
import Loadable exposing (Loadable(..))
import Process
import Request exposing (Request(..), failure)
import Route exposing (Route)
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, href, placeholder, src, title, type_)
import Ui.Card as Card
import Ui.Icons as Icons
import Ui.Keys as Keys
import Ui.Mana as Mana
import Ui.Nudge as Nudge exposing (Nudge)


suggestions : List String
suggestions =
    [ "Cut the weakest card for more removal"
    , "Re-optimize this for bracket 2"
    , "Make this deck cheaper"
    , "Swap a tapped land for an untapped dual"
    , "What are this deck's weaknesses?"
    ]


type alias Model =
    { open : Bool
    , messages : Loadable (List DeckChatMessage)
    , text : String
    , asking : Maybe Asking

    -- Asked whether to clear the chat, waiting for a yes.
    , confirmingClear : Bool

    -- Applying a message's changes or starting its re-run (by the message's id), or what last failed.
    , request : Request String
    , focus : Nudge
    , waitToken : Int
    }


{-| A message on its way to the doc, about one of the lists, and the reply as it's written.
-}
type alias Asking =
    { question : String
    , target : EditTarget
    , reply : String
    }


type Msg
    = ClickedOpen
    | AskedToClose
    | GotChat (Result String (List DeckChatMessage))
    | ChangedText String
    | Submitted EditTarget String
    | GotReply (Result String ChatAnswer)
    | Streamed Piece
    | ClickedClear
    | ClickedKeepChat
    | ConfirmedClear
    | GotCleared (Result String (List DeckChatMessage))
    | GotDeck (Result String DeckDetail)
    | ClickedApply String
    | GotApply String (Result String ( ChatAnswer, String ))
    | ClickedRerun String
    | GotRerun (Result String ( Slug, String ))
    | CheckDue Int (List String)
    | GotWaited (List String) (Result String (List DeckChatMessage))
    | CardMsg Card.Msg


{-| A piece of a reply as it's written: more text, or the whole of it when it starts over.
-}
type Piece
    = More String
    | Whole String


pieceDecoder : D.Decoder Piece
pieceDecoder =
    D.oneOf [ D.field "delta" D.string |> D.map More, D.field "text" D.string |> D.map Whole ]


type Out
    = Applied (Maybe Report)
    | Go Route
    | CardPreview Card.Msg


init : Model
init =
    { open = False
    , messages = Loading
    , text = ""
    , asking = Nothing
    , confirmingClear = False
    , request = Idle
    , focus = Nudge.initial
    , waitToken = 0
    }


{-| Fetched on every open, and again while open when the deck or its report changes: applying a
suggestion elsewhere on the page, or the refresh after an edit, can add a proposal.
-}
reload : Slug -> Model -> Cmd Msg
reload slug model =
    if model.open then
        Api.chat slug GotChat

    else
        Cmd.none


{-| Messages whose changes are being applied in the background.
-}
waiting : List DeckChatMessage -> List String
waiting messages =
    messages
        |> List.filterMap
            (\m ->
                case m of
                    DeckChatMessageAssistant answer ->
                        if answer.apply == Just ChatAnswerApplyApplying then
                            Just answer.id

                        else
                            Nothing

                    DeckChatMessageUser _ ->
                        Nothing
            )


idOf : DeckChatMessage -> String
idOf m =
    case m of
        DeckChatMessageUser q ->
            q.id

        DeckChatMessageAssistant a ->
            a.id


{-| Changes are applied in the background: check until they're in, then refresh the report (a
follow-up offer to re-run may arrive with them).
-}
withMessages : List DeckChatMessage -> Model -> ( Model, Cmd Msg )
withMessages messages model =
    let
        token =
            model.waitToken + 1

        ids =
            waiting messages
    in
    ( { model | messages = Loaded messages, waitToken = token }
    , if List.isEmpty ids then
        Cmd.none

      else
        Process.sleep 1000 |> Task.perform (\_ -> CheckDue token ids)
    )


{-| The messages so far: none while they load, or when they couldn't be.
-}
shownMessages : Model -> List DeckChatMessage
shownMessages model =
    Loadable.toMaybe model.messages |> Maybe.withDefault []


{-| The question a reply answers, as the saved history will have it.
-}
asked : ChatAnswer -> Asking -> DeckChatMessage
asked reply asking =
    DeckChatMessageUser { id = "asked:" ++ reply.id, content = asking.question, at = reply.at }


plain : ( Model, Cmd Msg ) -> ( Model, Cmd Msg, Maybe Out )
plain ( m, c ) =
    ( m, c, Nothing )


update : Env -> Slug -> Msg -> Model -> ( Model, Cmd Msg, Maybe Out )
update env slug msg model =
    case msg of
        ClickedOpen ->
            ( { model | open = True }, Api.chat slug GotChat, Nothing )

        AskedToClose ->
            ( { model | open = False }, Cmd.none, Nothing )

        GotChat (Ok messages) ->
            plain (withMessages messages model)

        GotChat (Err e) ->
            case model.messages of
                -- A reload that failed leaves the chat as it was.
                Loaded _ ->
                    plain ( model, Cmd.none )

                _ ->
                    plain ( { model | messages = Unavailable e }, Cmd.none )

        ChangedText t ->
            ( { model | text = t }, Cmd.none, Nothing )

        Submitted target message ->
            let
                content =
                    String.trim message
            in
            if content == "" || model.asking /= Nothing then
                ( model, Cmd.none, Nothing )

            else
                -- The message is sent by the stream element the view draws while it's answered.
                ( { model | request = Idle, asking = Just { question = content, target = target, reply = "" }, text = "" }
                , Cmd.none
                , Nothing
                )

        GotReply (Ok reply) ->
            let
                current =
                    shownMessages model

                -- Reopening the chat while it was answered may have brought the saved message and
                -- its question already.
                messages =
                    if List.any (\x -> idOf x == reply.id) current then
                        current

                    else
                        current ++ List.filterMap (Maybe.map (asked reply)) [ model.asking ] ++ [ DeckChatMessageAssistant reply ]

                ( m, cmd ) =
                    withMessages messages model

                done =
                    { m | asking = Nothing, focus = Nudge.next m.focus }
            in
            -- A "yes" to a proposed re-run starts it right away.
            case reply.rerun |> Maybe.andThen .jobId of
                Just jobId ->
                    ( done, cmd, Just (Go (Route.Job slug jobId)) )

                Nothing ->
                    if reply.reportUpdated then
                        ( done
                        , Cmd.batch
                            [ cmd
                            , Api.deck env.site slug GotDeck

                            -- A reply can apply an earlier proposal, which the history now marks as applied.
                            , Api.chat slug GotChat
                            ]
                        , Nothing
                        )

                    else
                        ( done, cmd, Nothing )

        GotReply (Err e) ->
            ( { model
                | request = Failed e
                , text = model.asking |> Maybe.map .question |> Maybe.withDefault model.text
                , asking = Nothing
                , focus = Nudge.next model.focus
              }
            , Cmd.none
            , Nothing
            )

        ClickedClear ->
            ( { model | confirmingClear = True }, Cmd.none, Nothing )

        ClickedKeepChat ->
            ( { model | confirmingClear = False }, Cmd.none, Nothing )

        ConfirmedClear ->
            ( model, Api.clearChat slug GotCleared, Nothing )

        GotCleared (Ok messages) ->
            plain (withMessages messages { model | confirmingClear = False, request = Idle })

        GotCleared (Err e) ->
            ( { model | confirmingClear = False, request = Failed e }, Cmd.none, Nothing )

        Streamed piece ->
            ( { model
                | asking =
                    model.asking
                        |> Maybe.map
                            (\a ->
                                { a
                                    | reply =
                                        case piece of
                                            More delta ->
                                                a.reply ++ delta

                                            Whole text ->
                                                text
                                }
                            )
              }
            , Cmd.none
            , Nothing
            )

        GotDeck (Ok detail) ->
            case detail.report of
                Just r ->
                    ( model, Cmd.none, Just (Applied (Just r)) )

                Nothing ->
                    ( model, Cmd.none, Nothing )

        GotDeck (Err _) ->
            ( model, Cmd.none, Nothing )

        ClickedApply id ->
            ( { model | request = Busy id }, Api.applyChat slug id (GotApply id), Nothing )

        GotApply id (Ok ( message, _ )) ->
            let
                ( m, cmd ) =
                    withMessages
                        (List.map
                            (\x ->
                                if idOf x == id then
                                    DeckChatMessageAssistant message

                                else
                                    x
                            )
                            (shownMessages model)
                        )
                        model
            in
            ( { m | request = Idle }, cmd, Just (Applied Nothing) )

        GotApply _ (Err e) ->
            ( { model | request = Failed e }, Cmd.none, Nothing )

        ClickedRerun id ->
            ( { model | request = Busy id }, Api.rerunFromChat slug id GotRerun, Nothing )

        GotRerun (Ok ( s, jobId )) ->
            ( model, Cmd.none, Just (Go (Route.Job s jobId)) )

        GotRerun (Err e) ->
            ( { model | request = Failed e }, Cmd.none, Nothing )

        CheckDue token ids ->
            if token == model.waitToken then
                ( model, Api.chat slug (GotWaited ids), Nothing )

            else
                ( model, Cmd.none, Nothing )

        GotWaited ids (Ok messages) ->
            let
                ( m, cmd ) =
                    withMessages messages model

                finished =
                    List.any (\id -> not (List.member id (waiting messages))) ids
            in
            ( m
            , cmd
            , if finished then
                Just (Applied Nothing)

              else
                Nothing
            )

        GotWaited _ (Err _) ->
            ( model, Cmd.none, Nothing )

        CardMsg m ->
            ( model, Cmd.none, Just (CardPreview m) )


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.open then
        Browser.Events.onKeyDown (Keys.onKeys [ ( "Escape", AskedToClose ) ])

    else
        Sub.none


{-| Sends the message being answered and streams the reply back (see `mtg-chat-stream` in
src/web/elements.ts).
-}
streamElement : Config -> Asking -> Html Msg
streamElement config asking =
    node "mtg-chat-stream"
        [ attribute "url" ("/api/decks/" ++ slugToString config.slug ++ "/chat")
        , property "body" (E.object [ ( "message", E.string asking.question ), ( "view", encodeEditTarget asking.target ) ])
        , on "reply" (D.field "detail" pieceDecoder |> D.map Streamed)
        , on "message" (D.field "detail" Api.answerDecoder |> D.map (Ok >> GotReply))
        , on "failure" (D.field "detail" D.string |> D.map (Err >> GotReply))
        ]
        []


type alias Config =
    { env : Env
    , slug : Slug
    , commander : String
    , target : EditTarget
    , index : Dict String CardPreview
    }


spinner : Html msg
spinner =
    span [ class "spinner", attribute "aria-hidden" "true" ] []


changesView : Config -> Card.Ctx Msg -> ChatAnswer -> Bool -> Html Msg
changesView config ctx message busy =
    let
        changes =
            message.changes
    in
    div [ class "chat-changes" ]
        [ ul []
            (List.map
                (\c ->
                    li
                        [ class
                            (changeActionToString c.action
                                ++ " "
                                ++ (case c.problem of
                                        Nothing ->
                                            ""

                                        Just _ ->
                                            "rejected"
                                   )
                            )
                        ]
                        [ span [ class "chat-change-sign", attribute "aria-label" (changeActionToString c.action) ]
                            [ text
                                (if c.action == ChangeActionAdd then
                                    "+"

                                 else
                                    "−"
                                )
                            ]
                        , div []
                            [ div [ class "chat-change-name" ]
                                ((if c.qty > 1 then
                                    [ span [ class "muted" ] [ text (String.fromInt c.qty ++ "× ") ] ]

                                  else
                                    []
                                 )
                                    ++ (case c.card of
                                            Just card ->
                                                [ Card.nameWith ctx { name = c.name, card = Just { image = card.image, scryfallUri = card.scryfallUri }, label = Nothing, class = Nothing, key = Nothing }
                                                , Mana.cost config.env.base 13 (Just card.manaCost)
                                                ]

                                            Nothing ->
                                                [ text c.name ]
                                       )
                                    ++ (case ( c.card |> Maybe.andThen .priceUsd, c.action ) of
                                            ( Just price, ChangeActionAdd ) ->
                                                [ span [ class "muted small" ] [ text ("$" ++ toFixed 2 price) ] ]

                                            _ ->
                                                []
                                       )
                                )
                            , div [ class "small muted" ]
                                (case c.problem of
                                    Nothing ->
                                        Card.prose ctx c.reason

                                    Just problem ->
                                        [ text ("Can't: " ++ problem) ]
                                )
                            ]
                        ]
                )
                changes
            )
        , case message.apply of
            Just (ChatAnswerApplyFailed { error }) ->
                p [ class "error small" ] [ text ("Couldn't apply: " ++ error) ]

            _ ->
                text ""
        , case message.apply of
            Just ChatAnswerApplyApplied ->
                div [ class "chat-applied small" ] [ text "✓ Applied" ]

            Just ChatAnswerApplyApplying ->
                div [ class "chat-applied small", attribute "role" "status" ] [ spinner, text " Applying…" ]

            _ ->
                applyButton config message busy changes
        ]


applyButton : Config -> ChatAnswer -> Bool -> List DeckChange -> Html Msg
applyButton config message busy changes =
    let
        valid =
            List.filter (\c -> c.problem == Nothing) changes

        count =
            List.length valid
    in
    if count > 0 then
        button [ class "primary", disabled busy, onClick (ClickedApply message.id) ]
            ((if busy then
                [ spinner ]

              else
                []
             )
                ++ [ text
                        ("Apply "
                            ++ String.fromInt count
                            ++ " change"
                            ++ (if count > 1 then
                                    "s"

                                else
                                    ""
                               )
                            ++ (if message.target == Just EditTargetOriginal then
                                    " to your deck"

                                else if config.target == EditTargetOriginal then
                                    " to the suggestions"

                                else
                                    ""
                               )
                        )
                   ]
            )

    else
        text ""


rerunView : Config -> ChatAnswer -> RerunProposal -> Bool -> Html Msg
rerunView config message r busy =
    div [ class "chat-changes chat-rerun" ]
        [ div [ class "chat-rerun-title" ] [ span [ attribute "aria-hidden" "true" ] [ text "↻" ], text " Re-run the optimizer" ]
        , p [ class "small" ]
            [ text
                (if r.keepEdits then
                    "Keeps your edits and refreshes the doc's other suggestions around them."

                 else
                    "With " ++ r.summary ++ ". This replaces the current suggestions and any chat edits."
                )
            ]
        , case r.jobId of
            Just jobId ->
                a [ class "small", href (Route.href config.env.site (Route.Job config.slug jobId)) ] [ text "✓ Started · see progress" ]

            Nothing ->
                button [ class "primary", disabled busy, onClick (ClickedRerun message.id) ]
                    ((if busy then
                        [ spinner ]

                      else
                        []
                     )
                        ++ [ text "Re-run" ]
                    )
        ]


{-| The chat button or panel, and while a message is answered, the stream that answers it: outside
the panel, so closing the chat doesn't cancel it.
-}
view : Config -> Model -> List (Html Msg)
view config model =
    panel config model
        :: (case model.asking of
                Just asking ->
                    [ streamElement config asking ]

                Nothing ->
                    []
           )


panel : Config -> Model -> Html Msg
panel config model =
    if not model.open then
        button [ class "chat-fab primary", onClick ClickedOpen, attribute "aria-label" "Ask the doc about this deck" ]
            [ img [ class "doc-avatar", src "./icon-96.png", alt "", width 30, height 30 ] []
            , text "Ask the doc"
            ]

    else
        let
            ctx =
                { index = config.index, gallery = Nothing, canHover = config.env.canHover, lift = CardMsg }
        in
        aside [ class "chat-panel", attribute "aria-label" "Deck chat" ]
            [ header [ class "chat-head" ]
                [ img [ class "doc-avatar lg", src "./icon-96.png", alt "", width 40, height 40 ] []
                , div [ class "grow" ]
                    [ strong [] [ text "The mtg doc" ]
                    , div [ class "muted small" ]
                        [ text
                            (config.commander
                                ++ " · "
                                ++ (if config.target == EditTargetOriginal then
                                        "your deck"

                                    else
                                        "suggested deck"
                                   )
                            )
                        ]
                    ]
                , if List.isEmpty (shownMessages model) || model.asking /= Nothing then
                    text ""

                  else
                    button
                        [ class "icon"
                        , attribute "aria-label" "Clear chat"
                        , title "Clear chat"
                        , onClick ClickedClear
                        , disabled model.confirmingClear
                        ]
                        [ Icons.trash ]
                , button [ class "icon", attribute "aria-label" "Close chat", onClick AskedToClose ] [ Icons.close ]
                ]
            , if model.confirmingClear then
                div [ class "chat-confirm", attribute "role" "alertdialog", attribute "aria-label" "Clear chat" ]
                    [ p [ class "small" ] [ text "Clear this chat? Your deck and its report stay as they are." ]
                    , div [ class "row end" ]
                        [ button [ class "small-btn", onClick ClickedKeepChat ] [ text "Cancel" ]
                        , button [ class "small-btn danger", onClick ConfirmedClear ] [ text "Clear chat" ]
                        ]
                    , node "mtg-focus" [ attribute "target" "button.danger" ] []
                    ]

              else
                text ""
            , div [ class "chat-messages" ]
                ((if model.messages == Loaded [] then
                    [ div [ class "chat-empty" ]
                        [ p [] [ text "Ask about the deck or tell me what to change. I'll propose additions and cuts that fit your bracket and budget; nothing changes until you apply it." ]
                        , div [ class "chat-suggestions" ]
                            (List.map (\s -> button [ class "chip-button", onClick (Submitted config.target s) ] [ text s ]) suggestions)
                        ]
                    ]

                  else
                    []
                 )
                    ++ List.map
                        (\message ->
                            case message of
                                DeckChatMessageUser q ->
                                    div [ class "chat-msg user" ] [ div [ class "chat-bubble" ] (Card.prose ctx q.content) ]

                                DeckChatMessageAssistant a ->
                                    div [ class "chat-msg assistant" ]
                                        (div [ class "chat-bubble" ] (Card.prose ctx a.content)
                                            :: (if List.isEmpty a.changes then
                                                    []

                                                else
                                                    [ changesView config ctx a (model.request == Busy a.id) ]
                                               )
                                            ++ (case a.rerun of
                                                    Just r ->
                                                        [ rerunView config a r (model.request == Busy a.id) ]

                                                    Nothing ->
                                                        []
                                               )
                                        )
                        )
                        (shownMessages model)
                    ++ (case model.asking of
                            Just asking ->
                                [ div [ class "chat-msg user" ] [ div [ class "chat-bubble" ] (Card.prose ctx asking.question) ]
                                , div [ class "chat-msg assistant" ]
                                    [ if asking.reply == "" then
                                        div [ class "chat-bubble typing", attribute "aria-label" "Thinking" ] [ span [] [], span [] [], span [] [] ]

                                      else
                                        div [ class "chat-bubble streaming" ] (Card.proseSoFar ctx asking.reply)
                                    ]
                                ]

                            Nothing ->
                                []
                       )
                    ++ [ node "mtg-stick-bottom" [] [] ]
                )
            , case ( model.messages, failure model.request ) of
                ( Unavailable e, _ ) ->
                    p [ class "error small chat-error" ] [ text ("Couldn't load the chat: " ++ e) ]

                ( _, Just e ) ->
                    p [ class "error small chat-error" ] [ text e ]

                _ ->
                    text ""
            , form [ class "chat-input", preventDefaultOn "submit" (D.succeed ( Submitted config.target model.text, True )) ]
                [ textarea
                    [ rows 2
                    , placeholder "e.g. swap Sol Ring for Mind Stone, or add more card draw"
                    , attribute "aria-label" "Message"
                    , value model.text
                    , onInput ChangedText
                    , preventDefaultOn "keydown"
                        (D.map3 (\k shift composing -> ( k, shift, composing ))
                            (D.field "key" D.string)
                            (D.field "shiftKey" D.bool)
                            (D.field "isComposing" D.bool)
                            |> D.andThen
                                (\( k, shift, composing ) ->
                                    if k == "Enter" && not shift && not composing then
                                        D.succeed ( Submitted config.target model.text, True )

                                    else
                                        D.fail "not a send"
                                )
                        )
                    ]
                    []
                , button [ type_ "submit", class "primary", disabled (String.trim model.text == "" || model.asking /= Nothing), attribute "aria-label" "Send" ] [ text "↑" ]
                , node "mtg-focus" [ attribute "target" "textarea", Nudge.attribute "token" model.focus ] []
                ]
            ]
