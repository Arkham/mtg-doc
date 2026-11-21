module ProseTest exposing (preview, suite, withIndex)

import CardRefs exposing (Part(..))
import Dict
import Expect
import Html exposing (div)
import Html.Attributes
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector exposing (attribute, class, tag, text)
import Types exposing (CardPreview)
import Ui.Card as Card


preview : String -> CardPreview
preview slug =
    { image = Just ("https://img.test/" ++ slug ++ ".jpg"), scryfallUri = "https://scryfall.test/" ++ slug, priceUsd = Nothing }


withIndex : List ( String, CardPreview ) -> Card.Ctx Card.Msg
withIndex entries =
    { index = Dict.fromList entries, gallery = Nothing, canHover = True, lift = identity }


index : Card.Ctx Card.Msg
index =
    withIndex
        [ ( "Sol Ring", preview "sol" )
        , ( "Mind Stone", preview "mind" )
        , ( "Six", preview "six" )
        , ( "Kefka, Court Mage // Kefka, Ruler of Ruin", preview "kefka" )
        ]


render : Card.Ctx Card.Msg -> String -> Query.Single Card.Msg
render ctx value =
    Query.fromHtml (div [] (Card.prose ctx value))


link : String -> String -> Query.Single msg -> Expect.Expectation
link label url =
    Query.find [ tag "a", attribute (Html.Attributes.attribute "href" url) ] >> Query.has [ text label ]


suite : Test
suite =
    describe "Card references in copy"
        [ test "only marked references become previews; a word that's also a card stays a word" <|
            \_ ->
                let
                    html =
                        render index "Build toward turn-six wins: cut [[Sol Ring]] for [[Mind Stone]], not six."
                in
                Expect.all
                    [ Query.findAll [ class "card-name" ] >> Query.count (Expect.equal 2)
                    , link "Sol Ring" "https://scryfall.test/sol"
                    , link "Mind Stone" "https://scryfall.test/mind"
                    , Query.findAll [ attribute (Html.Attributes.attribute "href" "https://scryfall.test/six") ] >> Query.count (Expect.equal 0)
                    , Query.hasNot [ text "[[" ]
                    , Query.has [ text "Build toward turn-six wins: cut ", text ", not six." ]
                    ]
                    html
        , test "a reference resolves to the index in any case, and double-faced cards by their front" <|
            \_ ->
                Expect.all
                    [ \_ -> link "sol ring" "https://scryfall.test/sol" (render index "[[sol ring]]")
                    , \_ -> link "Kefka, Court Mage" "https://scryfall.test/kefka" (render index "[[Kefka, Court Mage]] combos.")
                    ]
                    ()
        , test "text without references renders as it is" <|
            \_ ->
                render (withIndex []) "Cut Sol Ring. <b>no</b>"
                    |> Expect.all
                        [ Query.has [ text "Cut Sol Ring. <b>no</b>" ]
                        , Query.findAll [ tag "b" ] >> Query.count (Expect.equal 0)
                        ]
        , test "parts are the plain text and the cards referenced, in order" <|
            \_ ->
                CardRefs.parts "Pair [[Sol Ring]] with [[ Mind Stone ]]."
                    |> Expect.equal [ Words "Pair ", CardRef "Sol Ring", Words " with ", CardRef "Mind Stone", Words "." ]
        ]
