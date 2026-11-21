module MarkdownTest exposing (suite)

import Expect
import Html.Attributes
import ProseTest exposing (preview, withIndex)
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector exposing (attribute, class, containing, tag, text)
import Ui.Card as Card
import Ui.Markdown as Markdown


ctx : Card.Ctx Card.Msg
ctx =
    withIndex
        [ ( "Windfall", preview "windfall" )
        , ( "Hermit Druid", preview "hermit" )
        , ( "Thassa's Oracle", preview "oracle" )
        , ( "Kefka, Court Mage // Kefka, Ruler of Ruin", preview "kefka" )
        ]


render : String -> Query.Single Card.Msg
render =
    Markdown.view ctx >> Query.fromHtml


href : String -> Test.Html.Selector.Selector
href url =
    attribute (Html.Attributes.attribute "href" url)


suite : Test
suite =
    describe "Markdown"
        [ test "renders tables with a header row, inline formatting and missing cells" <|
            \_ ->
                render
                    (String.join "\n"
                        [ "## Key cards"
                        , ""
                        , "| Role | Cards |"
                        , "|---|:--|"
                        , "| **Wheels** | **Windfall**, [Wheel of Fortune](https://example.test) |"
                        , "| Draw punishment |"
                        , ""
                        , "After the table."
                        ]
                    )
                    |> Expect.all
                        [ Query.find [ tag "h4" ] >> Query.has [ text "Key cards" ]
                        , Query.find [ tag "table", class "data", class "md-table" ] >> Query.findAll [ tag "th" ] >> Query.count (Expect.equal 2)
                        , Query.find [ tag "tbody" ] >> Query.findAll [ tag "tr" ] >> Query.count (Expect.equal 2)
                        , Query.find [ tag "tbody" ] >> Query.findAll [ tag "td" ] >> Query.count (Expect.equal 4)
                        , Query.findAll [ tag "strong", containing [ text "Wheels" ] ] >> Query.count (Expect.equal 1)
                        , Query.find [ tag "a", href "https://example.test" ] >> Query.has [ text "Wheel of Fortune" ]
                        , Query.find [ tag "p" ] >> Query.has [ text "After the table." ]
                        , Query.hasNot [ text "|" ]
                        ]
        , test "pipe lines that aren't a table stay as text, and nothing is raw HTML" <|
            \_ ->
                render "| just a line with a pipe\n\n<b>hi</b>"
                    |> Expect.all
                        [ Query.findAll [ tag "p" ] >> Query.count (Expect.equal 2)
                        , Query.has [ text "| just a line with a pipe", text "<b>hi</b>" ]
                        , Query.findAll [ tag "b" ] >> Query.count (Expect.equal 0)
                        ]
        , test "card references become previews, bold text stays bold even when it's a card's name" <|
            \_ ->
                render "[[Windfall]] refills. **Windfall** is just bold. **[[Hermit Druid]] + [[Thassa’s Oracle]]** wins. [[Kefka, Court Mage]] combos. **Fixing:** matters."
                    |> Expect.all
                        [ Query.findAll [ class "card-name" ] >> Query.count (Expect.equal 4)
                        , Query.find [ tag "a", href "https://scryfall.test/windfall" ] >> Query.has [ text "Windfall" ]
                        , Query.findAll [ tag "strong" ] >> Query.first >> Query.hasNot [ class "card-name" ]
                        , Query.find [ tag "strong", containing [ href "https://scryfall.test/hermit" ] ] >> Query.has [ href "https://scryfall.test/oracle" ]
                        , Query.find [ tag "a", href "https://scryfall.test/kefka" ] >> Query.has [ text "Kefka, Court Mage" ]
                        , Query.findAll [ tag "strong", containing [ text "Fixing:" ] ] >> Query.count (Expect.equal 1)
                        ]
        , test "table cells link card references too" <|
            \_ ->
                render "| Role | Cards |\n|---|---|\n| Wheels | [[Windfall]] |"
                    |> Query.find [ tag "td", containing [ class "card-name" ] ]
                    |> Query.has [ href "https://scryfall.test/windfall" ]
        ]
