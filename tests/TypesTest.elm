module TypesTest exposing (suite)

import Expect
import Json.Decode as D
import Test exposing (Test, describe, test)
import Types exposing (Bracket(..), bracketDecoder, bracketToInt, bracketValues, deckChangeDecoder, encodeBracket)


suite : Test
suite =
    let
        change qty =
            """{"action":"add","name":"Sol Ring","qty":""" ++ qty ++ ""","reason":""}"""
    in
    describe "Types"
        [ test "a bracket is one of the five, and goes back out as its number" <|
            \_ ->
                List.map (encodeBracket >> D.decodeValue bracketDecoder) bracketValues
                    |> Expect.equal (List.map Ok [ Bracket1, Bracket2, Bracket3, Bracket4, Bracket5 ])
        , test "brackets are numbered 1 to 5" <|
            \_ -> List.map bracketToInt bracketValues |> Expect.equal [ 1, 2, 3, 4, 5 ]
        , test "anything else isn't a bracket" <|
            \_ ->
                List.map (D.decodeString bracketDecoder >> Result.toMaybe) [ "0", "6", "2.5", "\"3\"" ]
                    |> Expect.equal [ Nothing, Nothing, Nothing, Nothing ]
        , test "a card count is whole" <|
            \_ ->
                ( D.decodeString deckChangeDecoder (change "2") |> Result.map .qty |> Result.toMaybe
                , D.decodeString deckChangeDecoder (change "1.5") |> Result.toMaybe
                )
                    |> Expect.equal ( Just 2, Nothing )
        ]
