port module Parity exposing (main)

{-| Runs Elm code on data from tests/unit/elm-parity.test.ts, so it can be checked against the
server's JSON and against JavaScript itself.
-}

import Collate
import Format
import Json.Decode as D
import Json.Encode as E
import Route
import RunCopy
import Types


port request : (D.Value -> msg) -> Sub msg


port respond : E.Value -> Cmd msg


decoders : List ( String, D.Decoder () )
decoders =
    [ ( "report", D.map (always ()) Types.reportDecoder )
    , ( "detail", D.map (always ()) Types.deckDetailDecoder )
    , ( "chat", D.map (always ()) (D.list Types.deckChatMessageDecoder) )
    , ( "decks", D.map (always ()) (D.list Types.deckSummaryDecoder) )
    , ( "job", D.map (always ()) Types.jobDecoder )
    , ( "recognition", D.map (always ()) Types.recognitionDecoder )
    ]


run : D.Value -> E.Value
run value =
    let
        field name decoder =
            D.decodeValue (D.field name decoder) value
    in
    case field "kind" D.string of
        Ok "decode" ->
            case ( field "type" D.string, field "json" D.value ) of
                ( Ok t, Ok json ) ->
                    case List.filter (\( n, _ ) -> n == t) decoders of
                        [ ( _, decoder ) ] ->
                            case D.decodeValue decoder json of
                                Ok () ->
                                    E.null

                                Err e ->
                                    E.string (D.errorToString e)

                        _ ->
                            E.string ("No decoder for " ++ t)

                _ ->
                    E.string "Bad request"

        Ok "toFixed" ->
            field "cases" (D.list (D.map2 Tuple.pair (D.index 0 D.int) (D.index 1 D.float)))
                |> Result.map (List.map (\( d, x ) -> Format.toFixed d x) >> E.list E.string)
                |> Result.withDefault E.null

        Ok "sort" ->
            field "names" (D.list D.string)
                |> Result.map (Collate.sortBy identity >> E.list E.string)
                |> Result.withDefault E.null

        Ok "href" ->
            Result.map2
                (\isStatic routes -> E.list (Route.href isStatic >> E.string) routes)
                (field "isStatic" D.bool)
                (field "routes" (D.list Route.decoder))
                |> Result.withDefault E.null

        Ok "taskLabels" ->
            field "ids" (D.list D.string)
                |> Result.map (List.map (\id -> ( id, E.string (RunCopy.label id) )) >> E.object)
                |> Result.withDefault E.null

        _ ->
            E.string "Unknown request"


main : Program () () D.Value
main =
    Platform.worker
        { init = \_ -> ( (), Cmd.none )
        , update = \v _ -> ( (), respond (run v) )
        , subscriptions = \_ -> request identity
        }
