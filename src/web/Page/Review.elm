module Page.Review exposing (ListView, Match, Model, Msg, Out(..), Row, Suggestions, init, update, view)

import Api
import Cards
import Dict
import Env exposing (Env)
import Html exposing (Html, aside, button, datalist, details, div, form, h1, img, input, label, li, node, option, p, section, select, span, strong, summary, text, ul)
import Html.Attributes exposing (attribute, disabled, selected, value)
import Html.Events exposing (on, onClick, onFocus, onInput, preventDefaultOn)
import Html.Keyed as Keyed
import Json.Decode as D
import Json.Encode as E
import List.Extra
import Process
import Regex
import Request exposing (Request(..), failure, isBusy)
import Task
import Types exposing (..)
import Ui.Attr exposing (alt, class, id, placeholder, src, title, type_)
import Ui.Card as Card
import Ui.Icons as Icons
import Ui.Keys as Keys
import Ui.Mana as Mana
import Ui.Settings as Settings
import Ui.Sheet as Sheet
import Ui.Style exposing (ariaSelected)


{-| What a row's name resolved to: a card, exactly or by a close spelling; nothing; or being
looked up again (with the card it had, shown until the answer comes).
-}
type Match
    = Exact Card
    | Fuzzy Card
    | Unresolved
    | Checking (Maybe Card)


cardOf : Match -> Maybe Card
cardOf match =
    case match of
        Exact card ->
            Just card

        Fuzzy card ->
            Just card

        Unresolved ->
            Nothing

        Checking card ->
            card


{-| A name as the server resolved it. A match always has its card: one said to match without one
didn't.
-}
matchOf : NameMatch -> Maybe Card -> Match
matchOf status card =
    case ( status, card ) of
        ( NameMatchExact, Just c ) ->
            Exact c

        ( NameMatchFuzzy, Just c ) ->
            Fuzzy c

        _ ->
            Unresolved


type alias Row =
    { id : Int
    , qty : Int
    , name : String
    , raw : String
    , match : Match
    , locked : Bool
    , lang : Maybe String
    , confidence : Maybe Float
    }


type alias Suggestions =
    { query : String, items : List String, token : Int }


type ListView
    = All
    | Issues


type alias Model =
    { recognition : Recognition
    , photos : List String
    , format : DeckFormat
    , commanders : List String
    , deckName : String
    , rows : List Row
    , nextId : Int
    , options : OptimizeOptions
    , view : ListView
    , search : String
    , cmdr : Suggestions
    , names : Suggestions
    , adds : Suggestions
    , addQty : Int
    , adding : Request ()
    , flash : Maybe ( Int, Int )
    , focusAdd : Int
    , saving : Request ()

    -- A commander picked by name that couldn't be found.
    , unknownCommander : Maybe String
    }


type Which
    = Cmdr
    | Names
    | Adds


type Msg
    = ChoseFormat DeckFormat
    | ClickedRemoveCommander String
    | ChoseCommander String
    | GotCommander String (Result String (List ResolvedName))
    | ChangedQuery Which String
    | SuggestionsDue Which Int
    | GotSuggestions Which (Result String (List String))
    | ChangedDeckName String
    | ChangedQty Int Int
    | ChangedName Int String
    | FocusedName String
    | CommittedName Int String
    | GotRecheck Int String (Result String (List ResolvedName))
    | ToggledLock Int
    | ClickedRemoveRow Int
    | ChangedAddQty Int
    | SubmittedAdd
    | GotAdded String (Result String (List ResolvedName))
    | FlashFaded Int
    | ChoseView ListView
    | ChangedSearch String
    | ChangedOptions OptimizeOptions
    | ClickedSave
    | GotSaved (Result String ( String, String ))
    | ClickedPhoto String
    | CardMsg Card.Msg
    | ClickedCancel


type Out
    = Done String String
    | StartOver
    | OpenSheet Sheet.Model
    | Preview Card.Msg


init : Recognition -> List String -> Maybe AppConfig -> Model
init recognition photos config =
    let
        commanderRows =
            List.map
                (\c -> { qty = 1, name = c.name, raw = c.name, match = Exact c, lang = Nothing, confidence = Nothing })
                recognition.commanderCards

        entryRows =
            List.map
                (\e ->
                    { qty = e.qty
                    , name = e.name
                    , raw = e.raw
                    , match = matchOf e.status e.card
                    , lang = e.lang
                    , confidence = e.confidence
                    }
                )
                recognition.entries

        rows =
            List.indexedMap
                (\i r -> { id = i + 1, qty = r.qty, name = r.name, raw = r.raw, match = r.match, locked = False, lang = r.lang, confidence = r.confidence })
                (commanderRows ++ entryRows)
    in
    { recognition = recognition
    , photos = photos
    , format = recognition.format
    , commanders = recognition.commanders
    , deckName = Maybe.withDefault "" recognition.deckName
    , rows = rows
    , nextId = List.length rows + 1
    , options =
        { maxSwaps = 15
        , budgetPerCard = Nothing
        , budgetTotal = Nothing
        , bracket = Nothing
        , tone = ToneMax
        , locked = []
        , excluded = []
        , webResearch = config |> Maybe.map .webResearch |> Maybe.withDefault False
        }
    , view = All
    , search = ""
    , cmdr = noSuggestions
    , names = noSuggestions
    , adds = noSuggestions
    , addQty = 1
    , adding = Idle
    , flash = Nothing
    , focusAdd = 0
    , saving = Idle
    , unknownCommander = Nothing
    }


noSuggestions : Suggestions
noSuggestions =
    { query = "", items = [], token = 0 }


suggestionsOf : Which -> Model -> Suggestions
suggestionsOf which model =
    case which of
        Cmdr ->
            model.cmdr

        Names ->
            model.names

        Adds ->
            model.adds


withSuggestions : Which -> Suggestions -> Model -> Model
withSuggestions which s model =
    case which of
        Cmdr ->
            { model | cmdr = s }

        Names ->
            { model | names = s }

        Adds ->
            { model | adds = s }


{-| Autocomplete for a field: names for what's typed, fetched once typing pauses.
-}
query : Which -> String -> Model -> ( Model, Cmd Msg )
query which q model =
    let
        s =
            suggestionsOf which model

        next =
            { s | query = q, token = s.token + 1 }
    in
    ( withSuggestions which next model
    , if String.length q < 2 || q == s.query then
        Cmd.none

      else
        Process.sleep 200 |> Task.perform (\_ -> SuggestionsDue which next.token)
    )


mainRows : Model -> List Row
mainRows model =
    List.filter (\r -> not (List.member r.name model.commanders)) model.rows


commanderCards : Model -> List Card
commanderCards model =
    List.filterMap (\c -> List.Extra.find (\r -> r.name == c) model.rows |> Maybe.andThen (.match >> cardOf)) model.commanders


isOffColor : Model -> Row -> Bool
isOffColor model r =
    case ( model.format, commanderCards model, cardOf r.match ) of
        ( DeckFormatCommander, (_ :: _) as cards, Just card ) ->
            let
                identity =
                    List.concatMap .colorIdentity cards
            in
            not (List.all (\c -> List.member c identity) card.colorIdentity)

        _ ->
            False


needsAttention : Model -> Row -> Bool
needsAttention model r =
    not (isExact r) || isOffColor model r


updateRow : Int -> (Row -> Row) -> Model -> Model
updateRow id fn model =
    { model
        | rows =
            List.map
                (\r ->
                    if r.id == id then
                        fn r

                    else
                        r
                )
                model.rows
    }


isFuzzy : Row -> Bool
isFuzzy r =
    case r.match of
        Fuzzy _ ->
            True

        _ ->
            False


isChecking : Row -> Bool
isChecking r =
    case r.match of
        Checking _ ->
            True

        _ ->
            False


isExact : Row -> Bool
isExact r =
    case r.match of
        Exact _ ->
            True

        _ ->
            False


newRow : Model -> Int -> String -> String -> Match -> ( Row, Model )
newRow model qty name raw match =
    ( { id = model.nextId, qty = qty, name = name, raw = raw, match = match, locked = False, lang = Nothing, confidence = Nothing }
    , { model | nextId = model.nextId + 1 }
    )


none : Model -> ( Model, Cmd Msg, Maybe Out )
none model =
    ( model, Cmd.none, Nothing )


update : Msg -> Model -> ( Model, Cmd Msg, Maybe Out )
update msg model =
    case msg of
        ChoseFormat f ->
            none { model | format = f }

        ClickedRemoveCommander c ->
            none { model | commanders = List.filter ((/=) c) model.commanders }

        ChoseCommander raw ->
            if raw == "" || List.member raw model.commanders || List.length model.commanders >= 2 then
                none model

            else if List.any (\r -> r.name == raw) model.rows then
                none (addedCommander raw model)

            else
                ( model, Api.resolve [ raw ] (GotCommander raw), Nothing )

        GotCommander raw (Ok results) ->
            case List.head results |> Maybe.andThen (\res -> Maybe.map (Tuple.pair res) res.card) of
                Just ( res, card ) ->
                    let
                        ( row, m ) =
                            newRow model 1 card.name raw (matchOf res.status (Just card))
                    in
                    none (addedCommander card.name { m | rows = m.rows ++ [ row ] })

                Nothing ->
                    none { model | unknownCommander = Just raw }

        GotCommander _ (Err _) ->
            none model

        ChangedQuery which q ->
            let
                ( m, cmd ) =
                    query which q model
            in
            ( m, cmd, Nothing )

        SuggestionsDue which token ->
            let
                s =
                    suggestionsOf which model
            in
            if token == s.token then
                ( model, Api.autocomplete s.query (GotSuggestions which), Nothing )

            else
                none model

        GotSuggestions which (Ok items) ->
            let
                s =
                    suggestionsOf which model
            in
            none (withSuggestions which { s | items = items } model)

        GotSuggestions _ (Err _) ->
            none model

        ChangedDeckName n ->
            none { model | deckName = n }

        ChangedQty id q ->
            none (updateRow id (\r -> { r | qty = max 1 q }) model)

        ChangedName id n ->
            let
                ( m, cmd ) =
                    query Names n (updateRow id (\r -> { r | name = n, match = Unresolved }) model)
            in
            ( m, cmd, Nothing )

        FocusedName n ->
            let
                ( m, cmd ) =
                    query Names n model
            in
            ( m, cmd, Nothing )

        CommittedName id n ->
            ( updateRow id (\r -> { r | match = Checking (cardOf r.match) }) model, Api.resolve [ n ] (GotRecheck id n), Nothing )

        GotRecheck id n (Ok results) ->
            case List.head results of
                Just res ->
                    none
                        (updateRow id
                            (\r ->
                                { r
                                    | match = matchOf res.status res.card
                                    , name = res.card |> Maybe.map .name |> Maybe.withDefault n
                                }
                            )
                            model
                        )

                Nothing ->
                    none (updateRow id (\r -> { r | match = Unresolved }) model)

        GotRecheck id _ (Err _) ->
            none (updateRow id (\r -> { r | match = Unresolved }) model)

        ToggledLock id ->
            none (updateRow id (\r -> { r | locked = not r.locked }) model)

        ClickedRemoveRow id ->
            none { model | rows = List.filter (\r -> r.id /= id) model.rows }

        ChangedAddQty q ->
            none { model | addQty = max 1 q }

        SubmittedAdd ->
            let
                n =
                    String.trim model.adds.query
            in
            if n == "" then
                none model

            else
                ( { model | adding = Busy () }, Api.resolve [ n ] (GotAdded n), Nothing )

        GotAdded n result ->
            let
                finished m =
                    { m | focusAdd = m.focusAdd + 1 }
            in
            case result of
                Err e ->
                    none (finished { model | adding = Failed e })

                Ok results ->
                    case List.head results |> Maybe.andThen .card of
                        Nothing ->
                            none (finished { model | adding = Failed ("Couldn't find “" ++ n ++ "”. Pick a name from the suggestions.") })

                        Just card ->
                            let
                                ( flashed, withRow ) =
                                    case List.Extra.find (\r -> r.name == card.name) model.rows of
                                        Just existing ->
                                            ( existing.id, updateRow existing.id (\r -> { r | qty = r.qty + model.addQty }) model )

                                        Nothing ->
                                            let
                                                ( row, m ) =
                                                    newRow model model.addQty card.name card.name (Exact card)
                                            in
                                            ( row.id, { m | rows = row :: m.rows } )

                                token =
                                    model.flash |> Maybe.map Tuple.second |> Maybe.withDefault 0 |> (+) 1

                                adds =
                                    withRow.adds
                            in
                            ( finished
                                { withRow
                                    | adding = Idle
                                    , flash = Just ( flashed, token )
                                    , view = All
                                    , search = ""
                                    , adds = { adds | query = "", token = adds.token + 1 }
                                    , addQty = 1
                                }
                            , Process.sleep 1600 |> Task.perform (\_ -> FlashFaded token)
                            , Nothing
                            )

        FlashFaded token ->
            if Maybe.map Tuple.second model.flash == Just token then
                none { model | flash = Nothing }

            else
                none model

        ChoseView v ->
            none { model | view = v }

        ChangedSearch s ->
            none { model | search = s }

        ChangedOptions o ->
            none { model | options = o }

        ClickedSave ->
            let
                rows =
                    mainRows model

                body =
                    E.object
                        ([ ( "format", encodeDeckFormat model.format )
                         , ( "commanders"
                           , E.list E.string
                                (if model.format == DeckFormatCommander then
                                    model.commanders

                                 else
                                    []
                                )
                           )
                         , ( "deckName"
                           , if model.deckName == "" then
                                E.null

                             else
                                E.string model.deckName
                           )
                         , ( "entries"
                           , E.list
                                (\r -> E.object [ ( "name", E.string r.name ), ( "qty", E.int r.qty ) ])
                                (List.filter (\r -> r.match /= Unresolved) rows)
                           )
                         , ( "options"
                           , encodeOptimizeOptions
                                (let
                                    o =
                                        model.options
                                 in
                                 { o | locked = List.map .name (List.filter .locked rows) }
                                )
                           )
                         ]
                            ++ (case model.recognition.uploadToken of
                                    Just t ->
                                        [ ( "uploadToken", E.string t ) ]

                                    Nothing ->
                                        []
                               )
                        )
            in
            ( { model | saving = Busy (), unknownCommander = Nothing }, Api.save body GotSaved, Nothing )

        GotSaved (Ok ( slug, jobId )) ->
            ( model, Cmd.none, Just (Done slug jobId) )

        GotSaved (Err e) ->
            none { model | saving = Failed e }

        ClickedPhoto photo ->
            ( model
            , Cmd.none
            , Just
                (OpenSheet
                    (Sheet.open
                        { src = photo
                        , alt = "Deck photo"
                        , link = { href = photo, label = "Full size ↗" }
                        , wide = True
                        , foil = Nothing
                        }
                    )
                )
            )

        CardMsg m ->
            ( model, Cmd.none, Just (Preview m) )

        ClickedCancel ->
            ( model, Cmd.none, Just StartOver )


addedCommander : String -> Model -> Model
addedCommander name model =
    let
        cmdr =
            model.cmdr
    in
    { model | commanders = model.commanders ++ [ name ], cmdr = { cmdr | query = "", token = cmdr.token + 1 } }


groupOrder : List String
groupOrder =
    [ "Not recognized", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other" ]


groupOf : Row -> String
groupOf r =
    case cardOf r.match of
        Nothing ->
            "Not recognized"

        Just card ->
            let
                front =
                    String.split " // " card.typeLine |> List.head |> Maybe.withDefault ""
            in
            groupOrder
                |> List.Extra.find
                    (\g ->
                        Regex.fromString ("\\b" ++ g ++ "\\b")
                            |> Maybe.map (\re -> Regex.contains re front)
                            |> Maybe.withDefault False
                    )
                |> Maybe.withDefault "Other"


langName : String -> Maybe String
langName code =
    Dict.get code
        (Dict.fromList
            [ ( "it", "Italian" )
            , ( "de", "German" )
            , ( "fr", "French" )
            , ( "es", "Spanish" )
            , ( "pt", "Portuguese" )
            , ( "ja", "Japanese" )
            , ( "ko", "Korean" )
            , ( "ru", "Russian" )
            , ( "zhs", "Chinese" )
            , ( "zht", "Chinese" )
            ]
        )


{-| A quantity as typed: a whole number, or none (the update keeps it at least one).
-}
numberValue : String -> Int
numberValue s =
    String.toInt s |> Maybe.withDefault 0


view : Env -> Maybe AppConfig -> Model -> Html Msg
view env config model =
    let
        ctx =
            { index = Dict.empty, gallery = Nothing, canHover = env.canHover, lift = CardMsg }

        rows =
            mainRows model

        total =
            List.sum (List.map .qty rows) + List.length model.commanders

        unresolved =
            List.filter (\r -> r.match == Unresolved || isChecking r) rows

        fuzzy =
            List.filter isFuzzy rows

        offColor =
            List.filter (isOffColor model) rows

        issues =
            List.filter (needsAttention model) rows

        targetTotal =
            if model.format == DeckFormatCommander then
                Just 100

            else
                Nothing

        visible =
            rows
                |> List.filter (\r -> model.view == All || needsAttention model r)
                |> List.filter (\r -> model.search == "" || String.contains (String.toLower model.search) (String.toLower r.name))
                |> Cards.sortByManaValue (.match >> cardOf >> Maybe.map .cmc)

        groups =
            groupOrder
                |> List.map (\g -> ( g, List.filter (\r -> groupOf r == g) visible ))
                |> List.filter (\( _, rs ) -> not (List.isEmpty rs))

        canSave =
            not (isBusy model.saving) && (model.format /= DeckFormatCommander || not (List.isEmpty model.commanders))

        isCommander =
            model.format == DeckFormatCommander
    in
    div [ class "review" ]
        [ div [ class "page-head" ]
            [ div []
                [ h1 [] [ text "Check the cards" ]
                , p [ class "muted" ] [ text "Fix anything that was misread, confirm the commander, then optimize." ]
                ]
            , button [ class "ghost", onClick ClickedCancel ] [ text "Start over" ]
            ]
        , div
            [ class
                ("review-layout "
                    ++ (if List.isEmpty model.photos then
                            ""

                        else
                            "with-photos"
                       )
                )
            ]
            [ photoPane model.photos
            , div [ class "stack" ]
                [ section [ class "panel" ]
                    [ div [ class "status-chips" ]
                        [ span
                            [ class
                                ("status-chip "
                                    ++ (case targetTotal of
                                            Just t ->
                                                if total /= t then
                                                    "warn"

                                                else
                                                    "ok"

                                            Nothing ->
                                                "ok"
                                       )
                                )
                            ]
                            [ strong [] [ text (String.fromInt total) ]
                            , text
                                ((case targetTotal of
                                    Just t ->
                                        " / " ++ String.fromInt t

                                    Nothing ->
                                        ""
                                 )
                                    ++ " cards"
                                )
                            ]
                        , chip (not (List.isEmpty unresolved)) "bad" (String.fromInt (List.length unresolved) ++ " not recognized")
                        , chip (not (List.isEmpty fuzzy)) "warn" (String.fromInt (List.length fuzzy) ++ " auto-corrected")
                        , chip (not (List.isEmpty offColor)) "warn" (String.fromInt (List.length offColor) ++ " off-color")
                        , chip (List.isEmpty issues) "ok" "All cards recognized"
                        ]
                    , div [ class "setup-grid" ]
                        [ div [ class "field" ]
                            [ span [] [ text "Format" ]
                            , div [ class "segmented" ]
                                [ button [ ariaSelected isCommander, onClick (ChoseFormat DeckFormatCommander) ] [ text "Commander" ]
                                , button [ ariaSelected (model.format == DeckFormatOther), onClick (ChoseFormat DeckFormatOther) ] [ text "Other" ]
                                ]
                            ]
                        , if isCommander then
                            commanderField env ctx model

                          else
                            label [ class "field" ]
                                [ span [] [ text "Deck name" ]
                                , input [ value model.deckName, Ui.Attr.valueAttr model.deckName, onInput ChangedDeckName, placeholder "Used as the folder name" ] []
                                ]
                        ]
                    , if List.isEmpty model.recognition.notes then
                        text ""

                      else
                        details [ class "ai-notes" ]
                            [ summary [] [ text ("Notes from the scan (" ++ String.fromInt (List.length model.recognition.notes) ++ ")") ]
                            , ul [] (List.map (\n -> li [] [ text n ]) model.recognition.notes)
                            ]
                    ]
                , section [ class "panel" ]
                    [ form [ class "add-card", preventDefaultOn "submit" (D.succeed ( SubmittedAdd, True )) ]
                        [ input
                            [ type_ "number"
                            , attribute "inputmode" "numeric"
                            , Ui.Attr.min "1"
                            , class "qty"
                            , attribute "aria-label" "Quantity to add"
                            , value (String.fromInt model.addQty)
                            , Ui.Attr.valueAttr (String.fromInt model.addQty)
                            , onInput (numberValue >> ChangedAddQty)
                            ]
                            []
                        , input
                            [ attribute "list" "add-ac"
                            , attribute "aria-label" "Add a card"
                            , placeholder "Add a card: type a name and press Enter"
                            , value model.adds.query
                            , Ui.Attr.valueAttr model.adds.query
                            , onInput (ChangedQuery Adds)
                            ]
                            []
                        , suggestionList "add-ac" model.adds
                        , button [ type_ "submit", disabled (String.trim model.adds.query == "" || isBusy model.adding) ]
                            [ if isBusy model.adding then
                                span [ class "spinner", attribute "aria-hidden" "true" ] []

                              else
                                text "Add"
                            ]
                        , node "mtg-focus" [ attribute "target" "input[list=add-ac]", attribute "token" (String.fromInt model.focusAdd), attribute "lazy" "" ] []
                        ]
                    , case failure model.adding of
                        Just e ->
                            p [ class "bad-text small add-error" ] [ text e ]

                        Nothing ->
                            text ""
                    , div [ class "list-toolbar" ]
                        [ div [ class "segmented" ]
                            [ button [ ariaSelected (model.view == All), onClick (ChoseView All) ]
                                [ span [] [ text "All ", span [ class "count" ] [ text (String.fromInt (List.length rows)) ] ] ]
                            , button [ ariaSelected (model.view == Issues), onClick (ChoseView Issues) ]
                                [ span [] [ text "Needs attention ", span [ class "count" ] [ text (String.fromInt (List.length issues)) ] ] ]
                            ]
                        , input [ type_ "search", placeholder "Find a card", value model.search, Ui.Attr.valueAttr model.search, onInput ChangedSearch ] []
                        ]
                    , suggestionList "name-ac" model.names
                    , if List.isEmpty visible then
                        p [ class "muted empty" ]
                            [ text
                                (if model.view == Issues then
                                    "Nothing needs attention 🎉"

                                 else
                                    "No cards match."
                                )
                            ]

                      else
                        text ""
                    , Keyed.ul [ class "card-rows" ]
                        (List.concatMap
                            (\( group, groupRows ) ->
                                ( "group:" ++ group
                                , li [ class "group-head" ]
                                    [ text (group ++ " ")
                                    , span [ class "muted" ] [ text (String.fromInt (List.sum (List.map .qty groupRows))) ]
                                    ]
                                )
                                    :: List.map (\r -> ( String.fromInt r.id, cardRow env ctx model r )) groupRows
                            )
                            groups
                        )
                    ]
                , details [ class "panel disclosure" ]
                    [ summary []
                        [ span [] [ text "Optimization settings" ]
                        , span [ class "muted small" ] [ text (Settings.summary model.options) ]
                        ]
                    , Settings.view
                        { webResearch = config |> Maybe.map .webResearch |> Maybe.withDefault False
                        , onChange = ChangedOptions
                        }
                        model.options
                    ]
                ]
            ]
        , div [ class "action-bar" ]
            [ div [ class "action-bar-info small" ]
                [ case ( failure model.saving, model.unknownCommander ) of
                    ( Just e, _ ) ->
                        span [ class "bad-text" ] [ text e ]

                    ( Nothing, Just raw ) ->
                        span [ class "bad-text" ] [ text ("Couldn't find \"" ++ raw ++ "\".") ]

                    ( Nothing, Nothing ) ->
                        if isCommander && List.isEmpty model.commanders then
                            span [ class "warn" ] [ text "Pick a commander to continue" ]

                        else
                            span [ class "muted" ]
                                [ text
                                    (String.fromInt total
                                        ++ " cards"
                                        ++ (if not (List.isEmpty unresolved) then
                                                " · " ++ String.fromInt (List.length unresolved) ++ " unrecognized will be skipped"

                                            else
                                                ""
                                           )
                                    )
                                ]
                ]
            , button [ class "primary big", disabled (not canSave), onClick ClickedSave ]
                (if isBusy model.saving then
                    [ span [ class "spinner", attribute "aria-hidden" "true" ] [], text " Saving…" ]

                 else
                    [ text "Save & optimize" ]
                )
            ]
        ]


chip : Bool -> String -> String -> Html msg
chip shown tone label =
    if shown then
        span [ class ("status-chip " ++ tone) ] [ text label ]

    else
        text ""


suggestionList : String -> Suggestions -> Html msg
suggestionList listId s =
    datalist [ id listId ] (List.map (\item -> option [ Ui.Attr.optionValue item ] []) s.items)


commanderField : Env -> Card.Ctx Msg -> Model -> Html Msg
commanderField env ctx model =
    div [ class "field" ]
        [ span []
            [ text
                ("Commander"
                    ++ (if List.length model.commanders > 1 then
                            "s"

                        else
                            ""
                       )
                )
            ]
        , div [ class "commander-picks" ]
            (List.map
                (\c ->
                    div [ class "commander-pick" ]
                        [ case c.imageArt of
                            Just art ->
                                img [ src art, alt "" ] []

                            Nothing ->
                                text ""
                        , div []
                            [ Card.nameWith ctx { name = c.name, card = Just { image = c.image, scryfallUri = c.scryfallUri }, label = Nothing, class = Nothing, key = Nothing }
                            , Mana.cost env.base 14 (Just c.manaCost)
                            ]
                        , button [ class "icon", attribute "aria-label" ("Remove " ++ c.name), onClick (ClickedRemoveCommander c.name) ] [ Icons.close ]
                        ]
                )
                (commanderCards model)
                ++ (if List.length model.commanders < 2 then
                        let
                            candidates =
                                (model.recognition.commanderCandidates
                                    ++ List.filterMap
                                        (\r ->
                                            if Maybe.map .canBeCommander (cardOf r.match) == Just True then
                                                Just r.name

                                            else
                                                Nothing
                                        )
                                        model.rows
                                )
                                    |> List.Extra.unique
                                    |> List.filter (\c -> not (List.member c model.commanders))
                        in
                        [ Keyed.node "div"
                            [ class "commander-add" ]
                            [ ( "select:" ++ String.join "|" model.commanders
                              , if List.isEmpty candidates then
                                    text ""

                                else
                                    select [ on "change" (D.map ChoseCommander (D.at [ "target", "value" ] D.string)) ]
                                        (option [ Ui.Attr.optionValue "", selected True ]
                                            [ text
                                                (if List.isEmpty model.commanders then
                                                    "Pick from this deck…"

                                                 else
                                                    "Add partner…"
                                                )
                                            ]
                                            :: List.map (\c -> option [] [ text c ]) candidates
                                        )
                              )
                            , ( "input"
                              , input
                                    [ attribute "list" "cmdr-ac"
                                    , placeholder
                                        (if List.isEmpty model.commanders then
                                            "Search commander"

                                         else
                                            "Search partner"
                                        )
                                    , value model.cmdr.query
                                    , onInput (ChangedQuery Cmdr)
                                    , on "keydown" (Keys.onKeys [ ( "Enter", ChoseCommander model.cmdr.query ) ])
                                    ]
                                    []
                              )
                            , ( "list", suggestionList "cmdr-ac" model.cmdr )
                            ]
                        ]

                    else
                        []
                   )
            )
        ]


cardRow : Env -> Card.Ctx Msg -> Model -> Row -> Html Msg
cardRow env ctx model r =
    let
        off =
            isOffColor model r

        tone =
            if r.match == Unresolved then
                "bad"

            else if isFuzzy r || off then
                "warn"

            else
                ""

        flashed =
            Maybe.map Tuple.first model.flash == Just r.id

        key =
            "row:" ++ String.fromInt r.id

        hover =
            case cardOf r.match |> Maybe.andThen .image of
                Just image ->
                    if ctx.canHover then
                        [ on "mousemove"
                            (D.map2 (\x y -> CardMsg (Card.Hovered key image x y))
                                (D.field "clientX" D.float)
                                (D.field "clientY" D.float)
                            )
                        ]

                    else
                        []

                Nothing ->
                    []
    in
    li
        ([ class
            ("card-row "
                ++ tone
                ++ " "
                ++ (if flashed then
                        "flash"

                    else
                        ""
                   )
            )
         , on "mouseleave" (D.succeed (CardMsg (Card.Unhovered key)))
         ]
            ++ hover
        )
        ([ div [ class "thumb" ]
            [ case cardOf r.match of
                Just card ->
                    case card.imageArt of
                        Just art ->
                            Card.nameWith ctx
                                { name = r.name
                                , card = Just { image = card.image, scryfallUri = card.scryfallUri }
                                , label = Just [ img [ src art, alt "", attribute "loading" "lazy" ] [] ]
                                , class = Nothing
                                , key = Nothing
                                }

                        Nothing ->
                            span [] [ text "?" ]

                Nothing ->
                    span [] [ text "?" ]
            ]
         , input
            [ type_ "number"
            , attribute "inputmode" "numeric"
            , Ui.Attr.min "1"
            , class "qty"
            , attribute "aria-label" "Quantity"
            , value (String.fromInt r.qty)
            , Ui.Attr.valueAttr (String.fromInt r.qty)
            , onInput (numberValue >> ChangedQty r.id)
            ]
            []
         , div [ class "card-row-main" ]
            [ input
                [ attribute "list" "name-ac"
                , class "name"
                , attribute "aria-label" "Card name"
                , placeholder "Card name"
                , value r.name
                , Ui.Attr.valueAttr r.name
                , onFocus (FocusedName r.name)
                , onInput (ChangedName r.id)
                , on "blur"
                    (D.at [ "target", "value" ] D.string
                        |> D.andThen
                            (\v ->
                                if r.match == Unresolved && v /= "" then
                                    D.succeed (CommittedName r.id v)

                                else
                                    D.fail "nothing to check"
                            )
                    )
                ]
                []
            , div [ class "card-row-sub small" ]
                [ if r.match == Unresolved then
                    span [ class "bad-text" ] [ text "Not recognized. Fix the name or remove it." ]

                  else
                    text ""
                , if isChecking r then
                    span [ class "muted" ] [ text "Checking…" ]

                  else
                    text ""
                , if isFuzzy r then
                    span [ class "warn" ]
                        [ text
                            ("Read as “"
                                ++ r.raw
                                ++ "”"
                                ++ (case r.confidence of
                                        Just c ->
                                            if c < 1 then
                                                ", seen once"

                                            else
                                                ""

                                        Nothing ->
                                            ""
                                   )
                                ++ ". Check it’s right."
                            )
                        ]

                  else
                    text ""
                , if off then
                    span [ class "warn" ] [ text "Outside the commander’s colors, will be cut." ]

                  else
                    text ""
                , if isExact r && not off then
                    let
                        printed =
                            if r.raw /= "" && r.raw /= r.name then
                                Just r.raw

                            else
                                Nothing
                    in
                    span [ class "muted" ]
                        [ case cardOf r.match |> Maybe.map .manaCost of
                            Just cost ->
                                if cost /= "" then
                                    span [ class "card-row-cost-inline" ] [ Mana.cost env.base 13 (Just cost) ]

                                else
                                    text ""

                            Nothing ->
                                text ""
                        , text
                            ((cardOf r.match |> Maybe.map .typeLine |> Maybe.withDefault "")
                                ++ (case printed of
                                        Just p ->
                                            " · printed “"
                                                ++ p
                                                ++ "”"
                                                ++ (case r.lang |> Maybe.andThen langName of
                                                        Just l ->
                                                            " (" ++ l ++ ")"

                                                        Nothing ->
                                                            ""
                                                   )

                                        Nothing ->
                                            ""
                                   )
                            )
                        ]

                  else
                    text ""
                ]
            , node "mtg-blur-on-enter" [] []
            ]
         , span [ class "card-row-cost" ] [ Mana.cost env.base 15 (cardOf r.match |> Maybe.map .manaCost) ]
         , button
            [ class
                ("lock "
                    ++ (if r.locked then
                            "on"

                        else
                            ""
                       )
                )
            , attribute "aria-pressed"
                (if r.locked then
                    "true"

                 else
                    "false"
                )
            , title
                (if r.locked then
                    "Kept: will never be cut"

                 else
                    "Keep this card (never cut)"
                )
            , onClick (ToggledLock r.id)
            ]
            [ Icons.lock r.locked
            , span [ class "lock-label" ]
                [ text
                    (if r.locked then
                        "Kept"

                     else
                        "Keep"
                    )
                ]
            ]
         , button [ class "icon", attribute "aria-label" ("Remove " ++ r.name), onClick (ClickedRemoveRow r.id) ] [ Icons.trash ]
         ]
            ++ (if flashed then
                    [ node "mtg-scroll-into-view" [] [] ]

                else
                    []
               )
        )


photoPane : List String -> Html Msg
photoPane photos =
    if List.isEmpty photos then
        text ""

    else
        aside [ class "photo-pane" ]
            (List.indexedMap
                (\i photo ->
                    button [ class "photo", onClick (ClickedPhoto photo), attribute "aria-label" "Zoom photo" ]
                        [ img [ src photo, alt ("Deck photo " ++ String.fromInt (i + 1)) ] [] ]
                )
                photos
                ++ [ span [ class "muted small" ] [ text "Tap a photo to zoom and compare." ] ]
            )
