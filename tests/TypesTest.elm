module TypesTest exposing (suite)

import Api
import Expect
import Json.Decode as D
import Test exposing (Test, describe, test)
import Types exposing (Bracket(..), ChatAnswerApply(..), DeckChatMessage(..), bracketDecoder, bracketToInt, bracketValues, deckChangeDecoder, deckChatMessageDecoder, encodeBracket, encodeDeckChatMessage)


suite : Test
suite =
    let
        change qty =
            """{"action":"add","name":"Sol Ring","qty":""" ++ qty ++ ""","reason":""}"""

        question =
            """{"id":"q","role":"user","content":"add Sol Ring","at":"t","changes":[""" ++ change "1" ++ """]}"""

        answer =
            """{"id":"a","role":"assistant","content":"Done","at":"t","changes":[""" ++ change "1" ++ """],"apply":{"kind":"applied"}}"""
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
        , test "a question is only what was asked: changes come with answers" <|
            \_ ->
                D.decodeString deckChatMessageDecoder question
                    |> Expect.equal (Ok (DeckChatMessageUser { id = "q", content = "add Sol Ring", at = "t" }))
        , test "an answer keeps its changes and how applying them went, and goes back out as it came" <|
            \_ ->
                case D.decodeString deckChatMessageDecoder answer of
                    Ok ((DeckChatMessageAssistant a) as m) ->
                        ( ( List.map .name (Maybe.withDefault [] a.changes), a.apply )
                        , D.decodeValue deckChatMessageDecoder (encodeDeckChatMessage m)
                        )
                            |> Expect.equal ( ( [ "Sol Ring" ], Just ChatAnswerApplyApplied ), Ok m )

                    other ->
                        Expect.fail ("Not an answer: " ++ Debug.toString other)
        , test "a reply has to be the doc's answer" <|
            \_ ->
                ( D.decodeString Api.answerDecoder answer |> Result.map .id |> Result.toMaybe
                , D.decodeString Api.answerDecoder question |> Result.toMaybe
                )
                    |> Expect.equal ( Just "a", Nothing )
        ]
