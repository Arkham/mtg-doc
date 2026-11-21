module Api exposing
    ( Result_
    , Started(..)
    , applyChat
    , applyManaSuggestion
    , applySwap
    , autocomplete
    , chat
    , config
    , deck
    , decks
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
    , save
    , setPublishing
    )

{-| The server's API, or on the static site the JSON the build exported. Errors are the server's
message (`{ error }`), or a generic one with the status.
-}

import File exposing (File)
import Http
import Json.Decode as D exposing (Decoder)
import Json.Encode as E
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


config : Bool -> (Maybe AppConfig -> msg) -> Cmd msg
config isStatic toMsg =
    if isStatic then
        Cmd.none

    else
        get "/api/config" appConfigDecoder (Result.toMaybe >> toMsg)


decks : Bool -> (Result_ (List DeckSummary) -> msg) -> Cmd msg
decks isStatic =
    get
        (if isStatic then
            "data/decks.json"

         else
            "/api/decks"
        )
        (D.list deckSummaryDecoder)


deck : Bool -> String -> (Result_ DeckDetail -> msg) -> Cmd msg
deck isStatic slug =
    get
        (if isStatic then
            "data/decks/" ++ slug ++ "/detail.json"

         else
            "/api/decks/" ++ slug
        )
        deckDetailDecoder


fileUrl : Bool -> String -> String -> String
fileUrl isStatic slug file =
    if isStatic then
        "data/decks/" ++ slug ++ "/" ++ file

    else
        "/api/decks/" ++ slug ++ "/files/" ++ file


{-| A deck file's text, or Nothing when it isn't there.
-}
fileText : Bool -> String -> String -> (Maybe String -> msg) -> Cmd msg
fileText isStatic slug file toMsg =
    Http.get
        { url = fileUrl isStatic slug file
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


started : Decoder ( String, String )
started =
    D.map2 Tuple.pair (D.field "slug" D.string) (D.field "jobId" D.string)


save : E.Value -> (Result_ ( String, String ) -> msg) -> Cmd msg
save body =
    post "/api/decks" body started


reoptimize : String -> OptimizeOptions -> (Result_ ( String, String ) -> msg) -> Cmd msg
reoptimize slug options =
    post ("/api/decks/" ++ slug ++ "/optimize") (E.object [ ( "options", encodeOptimizeOptions options ) ]) started


job : String -> (Result_ Job -> msg) -> Cmd msg
job id =
    get ("/api/jobs/" ++ id) jobDecoder


editId : Decoder String
editId =
    D.field "editId" D.string


applyManaSuggestion : String -> String -> (Result_ String -> msg) -> Cmd msg
applyManaSuggestion slug id =
    postEmpty ("/api/decks/" ++ slug ++ "/mana-suggestions/" ++ id ++ "/apply") editId


{-| Makes one of the doc's swaps in the deck as submitted.
-}
applySwap : String -> Swap -> (Result_ String -> msg) -> Cmd msg
applySwap slug swap =
    post ("/api/decks/" ++ slug ++ "/swaps/apply")
        (E.object [ ( "out", E.string swap.out ), ( "in", E.string swap.in_ ) ])
        editId


edit : String -> (Result_ EditStatus -> msg) -> Cmd msg
edit id =
    get ("/api/edits/" ++ id) editStatusDecoder


refreshSynergies : String -> String -> (Result_ Report -> msg) -> Cmd msg
refreshSynergies slug mode =
    post ("/api/decks/" ++ slug ++ "/synergies") (E.object [ ( "mode", E.string mode ) ]) reportDecoder


chat : String -> (Result_ (List DeckChatMessage) -> msg) -> Cmd msg
chat slug =
    get ("/api/decks/" ++ slug ++ "/chat") (D.list deckChatMessageDecoder)


rerunFromChat : String -> String -> (Result_ ( String, String ) -> msg) -> Cmd msg
rerunFromChat slug messageId =
    postEmpty ("/api/decks/" ++ slug ++ "/chat/" ++ messageId ++ "/rerun") started


{-| Whether the published site shows the doc's suggestions for this deck.
-}
setPublishing : String -> Bool -> (Result_ DeckDetailMeta -> msg) -> Cmd msg
setPublishing slug suggestions toMsg =
    request
        { method = "PUT"
        , url = "/api/decks/" ++ slug ++ "/publishing"
        , body = Http.jsonBody (E.object [ ( "suggestions", E.bool suggestions ) ])
        , decoder = deckDetailMetaDecoder
        , toMsg = toMsg
        }


applyChat : String -> String -> (Result_ ( DeckChatMessage, String ) -> msg) -> Cmd msg
applyChat slug messageId =
    postEmpty ("/api/decks/" ++ slug ++ "/chat/" ++ messageId ++ "/apply")
        (D.map2 Tuple.pair (D.field "message" deckChatMessageDecoder) editId)
