module GalleryTest exposing (suite)

import Expect
import Test exposing (Test, describe, test)
import Ui.Gallery as Gallery


suite : Test
suite =
    let
        row =
            Gallery.focus ((==) "c") [ "a", "b", "c", "d" ]
    in
    describe "Ui.Gallery"
        [ test "opens on the one asked for, where it is in the row" <|
            \_ ->
                row
                    |> Maybe.map (\g -> ( Gallery.current g, Gallery.position g, Gallery.neighbours g ))
                    |> Expect.equal (Just ( "c", ( 3, 4 ), [ "b", "d" ] ))
        , test "isn't there for one the row doesn't have" <|
            \_ ->
                Gallery.focus ((==) "z") [ "a", "b" ]
                    |> Expect.equal Nothing
        , test "moves along the row both ways, and no further than its ends" <|
            \_ ->
                row
                    |> Maybe.map
                        (\g ->
                            [ Gallery.next g |> Maybe.map Gallery.current
                            , Gallery.next g |> Maybe.andThen Gallery.next |> Maybe.map Gallery.current
                            , Gallery.prev g |> Maybe.andThen Gallery.prev |> Maybe.map Gallery.current
                            , Gallery.prev g |> Maybe.andThen Gallery.prev |> Maybe.andThen Gallery.prev |> Maybe.map Gallery.current
                            ]
                        )
                    |> Expect.equal (Just [ Just "d", Nothing, Just "a", Nothing ])
        , test "back and forth comes back to the same place" <|
            \_ ->
                row
                    |> Maybe.andThen Gallery.prev
                    |> Maybe.andThen Gallery.next
                    |> Maybe.map (\g -> ( Gallery.current g, Gallery.position g ))
                    |> Expect.equal (Just ( "c", ( 3, 4 ) ))
        ]
