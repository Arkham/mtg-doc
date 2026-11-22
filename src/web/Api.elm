module Api exposing
    ( Result_
    , Started(..)
    , answerDecoder
    , applyChat
    , applyManaSuggestion
    , applySwap
    , autocomplete
    , chat
    , clearChat
    , config
    , deck
    , deckUrl
    , decksUnlessKnown
    , edit
    , fileText
    , fileUrl
    , job
    , recognitionJob
    , recognize
    , refreshSynergies
    , reoptimize
    , rerunFromChat
    , resolve
    , run
    , save
    , setPublishing
    , status
    )

{-| The server's API, or on the static site the JSON the build exported. Errors are the server's
message (`{ error }`), or a generic one with the status.
-}

import File exposing (File)
import Http
import Json.Decode as D exposing (Decoder)
import Json.Encode as E
import Site exposing (Site(..))
import Types exposing (..)
import Url


type alias Result_ a =
    Result String a


request :
    { method : String
    , url : String
    , body : Http.Body
    , decoder : Decoder a
    , toMsg : Result_ a -> msg
    }
    -> Cmd msg
request opts =
    Http.request
        { method = opts.method
        , headers = []
        , url = opts.url
        , body = opts.body
        , expect = Http.expectStringResponse opts.toMsg (respond opts.decoder)
        , timeout = Nothing
        , tracker = Nothing
        }


respond : Decoder a -> Http.Response String -> Result_ a
respond decoder response =
    case response of
        Http.GoodStatus_ _ body ->
            D.decodeString decoder body |> Result.mapError D.errorToString

        Http.BadStatus_ meta body ->
            Err
                (D.decodeString (D.field "error" D.string) body
                    |> Result.withDefault ("Request failed (" ++ String.fromInt meta.statusCode ++ ")")
                )

        Http.BadUrl_ url ->
            Err ("Bad URL: " ++ url)

        Http.Timeout_ ->
            Err "Request timed out"

        Http.NetworkError_ ->
            Err "Failed to fetch"


get : String -> Decoder a -> (Result_ a -> msg) -> Cmd msg
get url decoder toMsg =
    request { method = "GET", url = url, body = Http.emptyBody, decoder = decoder, toMsg = toMsg }


post : String -> E.Value -> Decoder a -> (Result_ a -> msg) -> Cmd msg
post url body decoder toMsg =
    request { method = "POST", url = url, body = Http.jsonBody body, decoder = decoder, toMsg = toMsg }


postEmpty : String -> Decoder a -> (Result_ a -> msg) -> Cmd msg
postEmpty url decoder toMsg =
    request { method = "POST", url = url, body = Http.emptyBody, decoder = decoder, toMsg = toMsg }


{-| The local app's settings (whether there's an LLM, ...). The published site has none to ask for.
-}
config : (Result_ AppConfig -> msg) -> Cmd msg
config =
    get "/api/config" appConfigDecoder


deckPath : Slug -> String
deckPath slug =
    "/api/decks/" ++ slugToString slug


{-| Where the same data lives: the server's API locally, the JSON the build exported on the
published site.
-}
at : Site -> { local : String, published : String } -> String
at site urls =
    case site of
        Local ->
            urls.local

        Published ->
            urls.published


decks : Site -> (Result_ (List DeckSummary) -> msg) -> Cmd msg
decks site =
    get (at site { local = "/api/decks", published = "data/decks.json" }) (D.list deckSummaryDecoder)


{-| The deck list, unless it's known: on the published site a list already at hand is the list (it
can't change while the page is open); anywhere else it's fetched again.
-}
decksUnlessKnown : Site -> Maybe (List DeckSummary) -> (Result_ (List DeckSummary) -> msg) -> Cmd msg
decksUnlessKnown site known =
    case ( site, known ) of
        ( Published, Just _ ) ->
            always Cmd.none

        _ ->
            decks site


deck : Site -> Slug -> (Result_ DeckDetail -> msg) -> Cmd msg
deck site slug =
    get (deckUrl site slug) deckDetailDecoder


{-| Where a deck's page gets its report, so the deck list can fetch it ahead of a tap.
-}
deckUrl : Site -> Slug -> String
deckUrl site slug =
    at site { local = "/api/decks/" ++ slugToString slug, published = "data/decks/" ++ slugToString slug ++ "/detail.json" }


{-| A deck's saved last optimizer run, to replay.
-}
run : Site -> Slug -> (Result_ RunRecord -> msg) -> Cmd msg
run site slug =
    get
        (at site { local = "/api/decks/" ++ slugToString slug ++ "/run", published = "data/decks/" ++ slugToString slug ++ "/run.json" })
        runRecordDecoder


fileUrl : Site -> Slug -> String -> String
fileUrl site slug file =
    at site { local = "/api/decks/" ++ slugToString slug ++ "/files/" ++ file, published = "data/decks/" ++ slugToString slug ++ "/" ++ file }


{-| Where a deck's changes stand, without its whole report.
-}
status : Slug -> (Result_ DeckStatus -> msg) -> Cmd msg
status slug =
    get (deckPath slug ++ "/status") deckStatusDecoder


{-| A deck file's text, or Nothing when it isn't there.
-}
fileText : Site -> Slug -> String -> (Maybe String -> msg) -> Cmd msg
fileText site slug file toMsg =
    Http.get
        { url = fileUrl site slug file
        , expect = Http.expectString (Result.toMaybe >> toMsg)
        }


{-| Text resolves immediately; photos return a job to poll with `recognitionJob`.
-}
type Started
    = Recognized Recognition
    | RecognitionStarted String


recognize : List File -> String -> (Result_ Started -> msg) -> Cmd msg
recognize images text toMsg =
    let
        parts =
            List.map (Http.filePart "images") images
                ++ (if text == "" then
                        []

                    else
                        [ Http.stringPart "text" text ]
                   )
    in
    request
        { method = "POST"
        , url = "/api/recognize"
        , body = Http.multipartBody parts
        , decoder =
            D.oneOf
                [ D.field "jobId" D.string |> D.map RecognitionStarted
                , recognitionDecoder |> D.map Recognized
                ]
        , toMsg = toMsg
        }


recognitionJob : String -> (Result_ RecognitionJob -> msg) -> Cmd msg
recognitionJob id =
    get ("/api/recognize/" ++ id) recognitionJobDecoder


resolve : List String -> (Result_ (List ResolvedName) -> msg) -> Cmd msg
resolve names =
    post "/api/cards/resolve" (E.object [ ( "names", E.list E.string names ) ]) (D.list resolvedNameDecoder)


autocomplete : String -> (Result_ (List String) -> msg) -> Cmd msg
autocomplete q =
    get ("/api/cards/autocomplete?q=" ++ Url.percentEncode q) (D.list D.string)


started : Decoder ( Slug, String )
started =
    D.map2 Tuple.pair (D.field "slug" slugDecoder) (D.field "jobId" D.string)


save : E.Value -> (Result_ ( Slug, String ) -> msg) -> Cmd msg
save body =
    post "/api/decks" body started


reoptimize : Slug -> OptimizeOptions -> (Result_ ( Slug, String ) -> msg) -> Cmd msg
reoptimize slug options =
    post (deckPath slug ++ "/optimize") (E.object [ ( "options", encodeOptimizeOptions options ) ]) started


job : String -> (Result_ Job -> msg) -> Cmd msg
job id =
    get ("/api/jobs/" ++ id) jobDecoder


editId : Decoder String
editId =
    D.field "editId" D.string


applyManaSuggestion : Slug -> String -> (Result_ String -> msg) -> Cmd msg
applyManaSuggestion slug id =
    postEmpty (deckPath slug ++ "/mana-suggestions/" ++ id ++ "/apply") editId


{-| Makes one of the doc's swaps in the deck as submitted.
-}
applySwap : Slug -> Swap -> (Result_ String -> msg) -> Cmd msg
applySwap slug swap =
    post (deckPath slug ++ "/swaps/apply")
        (E.object [ ( "out", E.string swap.out ), ( "in", E.string swap.in_ ) ])
        editId


edit : String -> (Result_ EditStatus -> msg) -> Cmd msg
edit id =
    get ("/api/edits/" ++ id) editStatusDecoder


refreshSynergies : Slug -> String -> (Result_ Report -> msg) -> Cmd msg
refreshSynergies slug mode =
    post (deckPath slug ++ "/synergies") (E.object [ ( "mode", E.string mode ) ]) reportDecoder


chat : Slug -> (Result_ (List DeckChatMessage) -> msg) -> Cmd msg
chat slug =
    get (deckPath slug ++ "/chat") (D.list deckChatMessageDecoder)


{-| Empties a deck's chat; the deck and its report stay as they are.
-}
clearChat : Slug -> (Result_ (List DeckChatMessage) -> msg) -> Cmd msg
clearChat slug toMsg =
    request
        { method = "DELETE"
        , url = deckPath slug ++ "/chat"
        , body = Http.emptyBody
        , decoder = D.list deckChatMessageDecoder
        , toMsg = toMsg
        }


rerunFromChat : Slug -> String -> (Result_ ( Slug, String ) -> msg) -> Cmd msg
rerunFromChat slug messageId =
    postEmpty (deckPath slug ++ "/chat/" ++ messageId ++ "/rerun") started


{-| Whether the published site shows the doc's suggestions for this deck.
-}
setPublishing : Slug -> Bool -> (Result_ DeckDetailMeta -> msg) -> Cmd msg
setPublishing slug suggestions toMsg =
    request
        { method = "PUT"
        , url = deckPath slug ++ "/publishing"
        , body = Http.jsonBody (E.object [ ( "suggestions", E.bool suggestions ) ])
        , decoder = deckDetailMetaDecoder
        , toMsg = toMsg
        }


applyChat : Slug -> String -> (Result_ ( ChatAnswer, String ) -> msg) -> Cmd msg
applyChat slug messageId =
    postEmpty (deckPath slug ++ "/chat/" ++ messageId ++ "/apply")
        (D.map2 Tuple.pair (D.field "message" answerDecoder) editId)


{-| A message from the doc: replies and applied proposals are never the user's.
-}
answerDecoder : Decoder ChatAnswer
answerDecoder =
    deckChatMessageDecoder
        |> D.andThen
            (\m ->
                case m of
                    DeckChatMessageAssistant answer ->
                        D.succeed answer

                    DeckChatMessageUser _ ->
                        D.fail "Expected the doc's answer, got a question"
            )
