module CardSearch exposing (Hits, Model, Msg(..), Out(..), hitsDecoder, init, update, view)

{-| Which decks run a card, by name, across every deck as submitted. The matching itself runs in
src/web/card-search.ts (it needs Unicode normalization, which Elm doesn't have).
-}

import Api
import Dict
import Env exposing (Env)
import Html exposing (Html, a, button, div, input, li, node, p, span, text, ul)
import Html.Attributes exposing (attribute, value)
import Html.Events exposing (on, onClick, onInput)
import Json.Decode as D
import Json.Encode as E
import List.Extra
import Loadable exposing (Loadable(..))
import Route
import Types exposing (..)
import Ui.Attr exposing (class, href, placeholder, type_)
import Ui.Card as Card
import Ui.Icons as Icons
import Ui.Mana as Mana
import Ui.Style exposing (aura)


minQuery : Int
minQuery =
    2


type alias Hits =
    { query : String
    , total : Int
    , hits : List { name : String, decks : List String }
    }


hitsDecoder : D.Decoder Hits
hitsDecoder =
    D.map3 Hits
        (D.field "query" D.string)
        (D.field "total" D.int)
        (D.field "hits"
            (D.list
                (D.map2 (\n d -> { name = n, decks = d })
                    (D.field "name" D.string)
                    (D.field "decks" (D.list D.string))
                )
            )
        )


type alias Model =
    { decks : Loadable (List DeckSummary)
    , query : String
    , hits : Hits
    }


type Msg
    = GotDecks (Result String (List DeckSummary))
    | SetQuery String
    | GotHits Hits
    | Close
    | CardMsg Card.Msg


type Out
    = Search E.Value
    | Closed
    | Preview Card.Msg


init : Env -> ( Model, Cmd Msg )
init env =
    ( { decks = Loading, query = "", hits = { query = "", total = 0, hits = [] } }
    , Api.decks env.isStatic GotDecks
    )


search : Model -> Maybe Out
search model =
    Maybe.map
        (\decks ->
            Search
                (E.object
                    [ ( "decks", E.list encodeDeckSummary decks )
                    , ( "query", E.string model.query )
                    ]
                )
        )
        (Loadable.toMaybe model.decks)


update : Msg -> Model -> ( Model, Maybe Out )
update msg model =
    case msg of
        GotDecks (Ok decks) ->
            let
                next =
                    { model | decks = Loaded decks }
            in
            ( next, search next )

        GotDecks (Err e) ->
            ( { model | decks = Unavailable e }, Nothing )

        SetQuery q ->
            let
                next =
                    { model | query = q }
            in
            ( next, search next )

        GotHits hits ->
            ( { model | hits = hits }, Nothing )

        Close ->
            ( model, Just Closed )

        CardMsg m ->
            ( model, Just (Preview m) )


view : Env -> Model -> Html Msg
view env model =
    div
        [ class "search-overlay"
        , on "click"
            (D.at [ "target", "className" ] D.string
                |> D.andThen
                    (\c ->
                        if c == "search-overlay" then
                            D.succeed Close

                        else
                            D.fail "inside"
                    )
            )
        ]
        [ div [ class "search-panel", attribute "role" "dialog", attribute "aria-modal" "true", attribute "aria-label" "Find a card" ]
            [ div [ class "search-field" ]
                [ Icons.search
                , input
                    [ type_ "search"
                    , attribute "aria-label" "Card name"
                    , placeholder "Which decks run… e.g. Sol Ring"
                    , attribute "autocomplete" "off"
                    , attribute "enterkeyhint" "search"
                    , value model.query
                    , Ui.Attr.valueAttr model.query
                    , onInput SetQuery
                    ]
                    []
                , button [ class "search-cancel", onClick Close ] [ text "Cancel" ]
                , node "mtg-focus" [ attribute "target" "input" ] []
                ]
            , div [ class "search-results" ]
                (case model.decks of
                    Unavailable e ->
                        [ p [ class "error small" ] [ text e ] ]

                    Loading ->
                        [ p [ class "muted small" ] [ span [ class "spinner", attribute "aria-hidden" "true" ] [], text " Loading decks…" ] ]

                    Loaded decks ->
                        let
                            typed =
                                String.length (String.trim model.query) >= minQuery
                        in
                        if not typed then
                            [ p [ class "muted small" ]
                                [ text
                                    ("Type a card name to see which of the "
                                        ++ String.fromInt (List.length decks)
                                        ++ " "
                                        ++ (if List.length decks == 1 then
                                                "deck runs"

                                            else
                                                "decks run"
                                           )
                                        ++ " it."
                                    )
                                ]
                            ]

                        else
                            let
                                results =
                                    if model.hits.query == model.query then
                                        model.hits

                                    else
                                        { query = model.query, total = 0, hits = [] }
                            in
                            if List.isEmpty results.hits then
                                [ p [ class "muted small" ] [ text ("No deck runs a card matching “" ++ String.trim model.query ++ "”.") ] ]

                            else
                                let
                                    ctx =
                                        { index = Dict.empty, gallery = Nothing, canHover = env.canHover, lift = CardMsg }
                                in
                                [ ul [ class "card-hits" ]
                                    (List.map
                                        (\h ->
                                            let
                                                hitDecks =
                                                    List.filterMap (\slug -> List.Extra.find (\d -> d.slug == slug) decks) h.decks

                                                n =
                                                    List.length hitDecks
                                            in
                                            li []
                                                [ div [ class "card-hit-name" ]
                                                    [ Card.name ctx h.name
                                                    , span [ class "muted small" ]
                                                        [ text
                                                            (String.fromInt n
                                                                ++ " "
                                                                ++ (if n == 1 then
                                                                        "deck"

                                                                    else
                                                                        "decks"
                                                                   )
                                                            )
                                                        ]
                                                    ]
                                                , div [ class "card-hit-decks" ]
                                                    (List.map
                                                        (\d ->
                                                            a
                                                                [ class "deck-chip"
                                                                , href (Route.deckHref env.isStatic d.slug Route.Current)
                                                                , aura d.colorIdentity
                                                                , onClick Close
                                                                ]
                                                                [ Mana.colorIdentity env.base 14 d.colorIdentity
                                                                , text
                                                                    (if List.isEmpty d.commanders then
                                                                        d.slug

                                                                     else
                                                                        String.join " + " d.commanders
                                                                    )
                                                                ]
                                                        )
                                                        hitDecks
                                                    )
                                                ]
                                        )
                                        results.hits
                                    )
                                , let
                                    more =
                                        results.total - List.length results.hits
                                  in
                                  if more > 0 then
                                    p [ class "muted small" ]
                                        [ text
                                            (String.fromInt more
                                                ++ " more "
                                                ++ (if more == 1 then
                                                        "card matches"

                                                    else
                                                        "cards match"
                                                   )
                                                ++ "; keep typing to narrow it down."
                                            )
                                        ]

                                  else
                                    text ""
                                ]
                )
            ]
        , node "mtg-scroll-lock" [] []
        ]
