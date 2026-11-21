module Chat exposing (Config, Model, Msg, Out(..), init, slugChanged, subscriptions, update, view)

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
import Process
import Route
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, href, placeholder, src, type_)
import Ui.Card as Card
import Ui.Mana as Mana


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
    , messages : Maybe (List DeckChatMessage)
    , text : String
    , sending : Bool

    -- The doc's reply as it's written, while a message is answered.
    , streamed : String
    , pendingTarget : EditTarget
    , applying : Maybe String
    , error : Maybe String
    , focus : Int
    , waitToken : Int
    }


type Msg
    = Open
    | Close
    | GotChat (Result String (List DeckChatMessage))
    | SetText String
    | SendIn EditTarget String
    | GotReply String (Result String DeckChatMessage)
    | Streamed Piece
    | GotDeck (Result String DeckDetail)
    | Apply String
    | GotApply String (Result String ( DeckChatMessage, String ))
    | Rerun String
    | GotRerun (Result String ( String, String ))
    | Wait Int String
    | GotWaited String (Result String (List DeckChatMessage))
    | CardMsg Card.Msg
    | Ignore


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
    | Go String
    | CardPreview Card.Msg


init : Model
init =
    { open = False
    , messages = Nothing
    , text = ""
    , sending = False
    , streamed = ""
    , pendingTarget = EditTargetOptimized
    , applying = Nothing
    , error = Nothing
    , focus = 0
    , waitToken = 0
    }


{-| Fetched on every open (and when the deck changes while open): applying a suggestion
elsewhere on the page can add a proposal.
-}
slugChanged : String -> Model -> Cmd Msg
slugChanged slug model =
    if model.open then
        Api.chat slug GotChat

    else
        Cmd.none


waiting : Maybe (List DeckChatMessage) -> String
waiting messages =
    messages
        |> Maybe.withDefault []
        |> List.filter (\m -> m.applying == Just True)
        |> List.map .id
        |> String.join ","


{-| Changes are applied in the background: check until they're in, then refresh the report (a
follow-up offer to re-run may arrive with them).
-}
withMessages : Maybe (List DeckChatMessage) -> Model -> ( Model, Cmd Msg )
withMessages messages model =
    let
        token =
            model.waitToken + 1

        ids =
            waiting messages
    in
    ( { model | messages = messages, waitToken = token }
    , if ids == "" then
        Cmd.none

      else
        Process.sleep 1000 |> Task.perform (\_ -> Wait token ids)
    )


plain : ( Model, Cmd Msg ) -> ( Model, Cmd Msg, Maybe Out )
plain ( m, c ) =
    ( m, c, Nothing )


update : Env -> String -> Msg -> Model -> ( Model, Cmd Msg, Maybe Out )
update env slug msg model =
    case msg of
        Open ->
            ( { model | open = True }, Api.chat slug GotChat, Nothing )

        Close ->
            ( { model | open = False }, Cmd.none, Nothing )

        GotChat (Ok messages) ->
            -- The message being answered is saved with its answer, so the history doesn't have it yet.
            let
                answering =
                    if model.sending then
                        List.filter (\m -> m.id == "pending") (Maybe.withDefault [] model.messages)

                    else
                        []
            in
            plain (withMessages (Just (messages ++ answering)) model)

        GotChat (Err _) ->
            plain (withMessages (Just (Maybe.withDefault [] model.messages)) model)

        SetText t ->
            ( { model | text = t }, Cmd.none, Nothing )

        SendIn target message ->
            let
                content =
                    String.trim message
            in
            if content == "" || model.sending then
                ( model, Cmd.none, Nothing )

            else
                let
                    pending =
                        { id = "pending"
                        , role = DeckChatMessageRoleUser
                        , content = content
                        , at = ""
                        , changes = Nothing
                        , applied = Nothing
                        , applying = Nothing
                        , applyError = Nothing
                        , rerun = Nothing
                        , target = Nothing
                        , reportUpdated = Nothing
                        }

                    ( m, cmd ) =
                        withMessages (Just (Maybe.withDefault [] model.messages ++ [ pending ])) model
                in
                -- The message is sent by the stream element the view draws while it's answered.
                ( { m | error = Nothing, sending = True, streamed = "", text = "", pendingTarget = target }
                , cmd
                , Nothing
                )

        GotReply _ (Ok reply) ->
            let
                current =
                    Maybe.withDefault [] model.messages

                -- Reopening the chat while it was answered may have brought the saved message and
                -- its question already.
                messages =
                    if List.any (\x -> x.id == reply.id) current then
                        List.filter (\x -> x.id /= "pending") current

                    else
                        -- The question stays, no longer waiting for an answer.
                        List.map
                            (\x ->
                                if x.id == "pending" then
                                    { x | id = "asked:" ++ reply.id }

                                else
                                    x
                            )
                            current
                            ++ [ reply ]

                ( m, cmd ) =
                    withMessages (Just messages) model

                done =
                    { m | sending = False, streamed = "", focus = m.focus + 1 }
            in
            -- A "yes" to a proposed re-run starts it right away.
            case reply.rerun |> Maybe.andThen .jobId of
                Just jobId ->
                    ( done, cmd, Just (Go (Route.href env.isStatic (Route.Job slug jobId))) )

                Nothing ->
                    if reply.reportUpdated == Just True then
                        ( done
                        , Cmd.batch
                            [ cmd
                            , Api.deck env.isStatic slug GotDeck

                            -- A reply can apply an earlier proposal, which the history now marks as applied.
                            , Api.chat slug GotChat
                            ]
                        , Nothing
                        )

                    else
                        ( done, cmd, Nothing )

        GotReply content (Err e) ->
            let
                ( m, cmd ) =
                    withMessages (Maybe.map (List.filter (\x -> x.id /= "pending")) model.messages) model
            in
            ( { m | error = Just e, text = content, sending = False, streamed = "", focus = m.focus + 1 }, cmd, Nothing )

        Streamed piece ->
            ( { model
                | streamed =
                    case piece of
                        More delta ->
                            model.streamed ++ delta

                        Whole text ->
                            text
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

        Apply id ->
            ( { model | applying = Just id, error = Nothing }, Api.applyChat slug id (GotApply id), Nothing )

        GotApply id (Ok ( message, _ )) ->
            let
                ( m, cmd ) =
                    withMessages
                        (Maybe.map
                            (List.map
                                (\x ->
                                    if x.id == id then
                                        message

                                    else
                                        x
                                )
                            )
                            model.messages
                        )
                        model
            in
            ( { m | applying = Nothing }, cmd, Just (Applied Nothing) )

        GotApply _ (Err e) ->
            ( { model | applying = Nothing, error = Just e }, Cmd.none, Nothing )

        Rerun id ->
            ( { model | applying = Just id, error = Nothing }, Api.rerunFromChat slug id GotRerun, Nothing )

        GotRerun (Ok ( s, jobId )) ->
            ( model, Cmd.none, Just (Go (Route.href env.isStatic (Route.Job s jobId))) )

        GotRerun (Err e) ->
            ( { model | applying = Nothing, error = Just e }, Cmd.none, Nothing )

        Wait token ids ->
            if token == model.waitToken then
                ( model, Api.chat slug (GotWaited ids), Nothing )

            else
                ( model, Cmd.none, Nothing )

        GotWaited ids (Ok messages) ->
            let
                ( m, cmd ) =
                    withMessages (Just messages) model

                finished =
                    String.split "," ids
                        |> List.any (\id -> not (List.any (\x -> x.id == id && x.applying == Just True) messages))
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

        Ignore ->
            ( model, Cmd.none, Nothing )


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.open then
        Browser.Events.onKeyDown
            (D.field "key" D.string
                |> D.map
                    (\k ->
                        if k == "Escape" then
                            Close

                        else
                            Ignore
                    )
            )

    else
        Sub.none


{-| Sends the message being answered and streams the reply back (see `mtg-chat-stream` in
src/elements.ts).
-}
streamElement : Config -> Model -> Html Msg
streamElement config model =
    let
        content =
            model.messages
                |> Maybe.withDefault []
                |> List.filter (\m -> m.id == "pending")
                |> List.head
                |> Maybe.map .content
                |> Maybe.withDefault ""
    in
    node "mtg-chat-stream"
        [ attribute "url" ("/api/decks/" ++ config.slug ++ "/chat")
        , property "body" (E.object [ ( "message", E.string content ), ( "view", encodeEditTarget model.pendingTarget ) ])
        , on "reply" (D.field "detail" pieceDecoder |> D.map Streamed)
        , on "message" (D.field "detail" deckChatMessageDecoder |> D.map (Ok >> GotReply content))
        , on "failure" (D.field "detail" D.string |> D.map (Err >> GotReply content))
        ]
        []


type alias Config =
    { env : Env
    , slug : String
    , commander : String
    , target : EditTarget
    , index : Dict String CardPreview
    }


spinner : Html msg
spinner =
    span [ class "spinner", attribute "aria-hidden" "true" ] []


changesView : Config -> Card.Ctx Msg -> DeckChatMessage -> Bool -> Html Msg
changesView config ctx message busy =
    let
        changes =
            Maybe.withDefault [] message.changes
    in
    div [ class "chat-changes" ]
        [ ul []
            (List.map
                (\c ->
                    li
                        [ class
                            (deckChangeActionToString c.action
                                ++ " "
                                ++ (if c.ok then
                                        ""

                                    else
                                        "rejected"
                                   )
                            )
                        ]
                        [ span [ class "chat-change-sign", attribute "aria-label" (deckChangeActionToString c.action) ]
                            [ text
                                (if c.action == DeckChangeActionAdd then
                                    "+"

                                 else
                                    "−"
                                )
                            ]
                        , div []
                            [ div [ class "chat-change-name" ]
                                ((if c.qty > 1 then
                                    [ span [ class "muted" ] [ text (String.fromFloat c.qty ++ "× ") ] ]

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
                                            ( Just price, DeckChangeActionAdd ) ->
                                                [ span [ class "muted small" ] [ text ("$" ++ toFixed 2 price) ] ]

                                            _ ->
                                                []
                                       )
                                )
                            , div [ class "small muted" ]
                                (if c.ok then
                                    Card.prose ctx c.reason

                                 else
                                    [ text ("Can't: " ++ Maybe.withDefault "undefined" c.problem) ]
                                )
                            ]
                        ]
                )
                changes
            )
        , case message.applyError of
            Just e ->
                p [ class "error small" ] [ text ("Couldn't apply: " ++ e) ]

            Nothing ->
                text ""
        , if message.applied == Just True then
            div [ class "chat-applied small" ] [ text "✓ Applied" ]

          else if message.applying == Just True then
            div [ class "chat-applied small", attribute "role" "status" ] [ spinner, text " Applying…" ]

          else
            let
                valid =
                    List.filter .ok changes

                count =
                    List.length valid
            in
            if count > 0 then
                button [ class "primary", disabled busy, onClick (Apply message.id) ]
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
        ]


rerunView : Config -> DeckChatMessage -> RerunProposal -> Bool -> Html Msg
rerunView config message r busy =
    div [ class "chat-changes chat-rerun" ]
        [ div [ class "chat-rerun-title" ] [ span [ attribute "aria-hidden" "true" ] [ text "↻" ], text " Re-run the optimizer" ]
        , p [ class "small" ]
            [ text
                (if r.keepEdits == Just True then
                    "Keeps your edits and refreshes the doc's other suggestions around them."

                 else
                    "With " ++ r.summary ++ ". This replaces the current suggestions and any chat edits."
                )
            ]
        , case r.jobId of
            Just jobId ->
                a [ class "small", href (Route.href config.env.isStatic (Route.Job config.slug jobId)) ] [ text "✓ Started · see progress" ]

            Nothing ->
                button [ class "primary", disabled busy, onClick (Rerun message.id) ]
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
        :: (if model.sending then
                [ streamElement config model ]

            else
                []
           )


panel : Config -> Model -> Html Msg
panel config model =
    if not model.open then
        button [ class "chat-fab primary", onClick Open, attribute "aria-label" "Ask the doc about this deck" ]
            [ img [ class "doc-avatar", src "./icon-96.png", alt "", width 30, height 30 ] []
            , text " Ask"
            , span [ class "chat-fab-long" ] [ text " the doc" ]
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
                , button [ class "icon", attribute "aria-label" "Close chat", onClick Close ] [ text "✕" ]
                ]
            , div [ class "chat-messages" ]
                ((if model.messages == Just [] then
                    [ div [ class "chat-empty" ]
                        [ p [] [ text "Ask about the deck or tell me what to change. I'll propose additions and cuts that fit your bracket and budget; nothing changes until you apply it." ]
                        , div [ class "chat-suggestions" ]
                            (List.map (\s -> button [ class "chip-button", onClick (SendIn config.target s) ] [ text s ]) suggestions)
                        ]
                    ]

                  else
                    []
                 )
                    ++ List.map
                        (\m ->
                            div [ class ("chat-msg " ++ deckChatMessageRoleToString m.role) ]
                                (div [ class "chat-bubble" ] (Card.prose ctx m.content)
                                    :: (if m.role == DeckChatMessageRoleAssistant && not (List.isEmpty (Maybe.withDefault [] m.changes)) then
                                            [ changesView config ctx m (model.applying == Just m.id) ]

                                        else
                                            []
                                       )
                                    ++ (case ( m.role, m.rerun ) of
                                            ( DeckChatMessageRoleAssistant, Just r ) ->
                                                [ rerunView config m r (model.applying == Just m.id) ]

                                            _ ->
                                                []
                                       )
                                )
                        )
                        (Maybe.withDefault [] model.messages)
                    ++ (if model.sending then
                            [ div [ class "chat-msg assistant" ]
                                [ if model.streamed == "" then
                                    div [ class "chat-bubble typing", attribute "aria-label" "Thinking" ] [ span [] [], span [] [], span [] [] ]

                                  else
                                    div [ class "chat-bubble streaming" ] (Card.proseSoFar ctx model.streamed)
                                ]
                            ]

                        else
                            []
                       )
                    ++ [ node "mtg-stick-bottom" [] [] ]
                )
            , case model.error of
                Just e ->
                    p [ class "error small chat-error" ] [ text e ]

                Nothing ->
                    text ""
            , form [ class "chat-input", preventDefaultOn "submit" (D.succeed ( SendIn config.target model.text, True )) ]
                [ textarea
                    [ rows 2
                    , placeholder "e.g. swap Sol Ring for Mind Stone, or add more card draw"
                    , attribute "aria-label" "Message"
                    , value model.text
                    , onInput SetText
                    , preventDefaultOn "keydown"
                        (D.map3 (\k shift composing -> ( k, shift, composing ))
                            (D.field "key" D.string)
                            (D.field "shiftKey" D.bool)
                            (D.field "isComposing" D.bool)
                            |> D.andThen
                                (\( k, shift, composing ) ->
                                    if k == "Enter" && not shift && not composing then
                                        D.succeed ( SendIn config.target model.text, True )

                                    else
                                        D.fail "not a send"
                                )
                        )
                    ]
                    []
                , button [ type_ "submit", class "primary", disabled (String.trim model.text == "" || model.sending), attribute "aria-label" "Send" ] [ text "↑" ]
                , node "mtg-focus" [ attribute "target" "textarea", attribute "token" (String.fromInt model.focus) ] []
                ]
            ]
