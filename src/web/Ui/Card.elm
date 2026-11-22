module Ui.Card exposing
    ( CardLike
    , Ctx
    , Hover
    , Item
    , Msg(..)
    , galleryItems
    , list
    , name
    , nameWith
    , previews
    , prose
    , proseSoFar
    , updateHovers
    , withGallery
    )

{-| Card names that preview the card: a floating image on hover, a full-screen sheet on tap for
touch devices. Every card shown on a page goes through here.
-}

import CardRefs
import Dict exposing (Dict)
import Html exposing (Html, a, img, span, text)
import Html.Attributes exposing (style)
import Html.Events exposing (on, preventDefaultOn)
import Json.Decode as D
import Types exposing (CardPreview)
import Ui.Attr exposing (alt, class, href, rel, src, target)
import Ui.Gallery as Gallery exposing (Gallery)
import Url


{-| What a card name needs to preview a card.
-}
type alias CardLike =
    { image : Maybe String
    , scryfallUri : String
    }


{-| A card in a gallery's sheet.
-}
type alias Item =
    { name : String
    , image : String
    , href : String
    }


type alias Ctx msg =
    { index : Dict String CardPreview
    , gallery : Maybe (List Item)
    , canHover : Bool
    , lift : Msg -> msg
    }


type Msg
    = Hovered String String Float Float
    | Leave String
    | Open Item
    | OpenGallery (Gallery Item)


{-| A floating preview following the pointer, one per element being hovered.
-}
type alias Hover =
    { key : String
    , image : String
    , x : Float
    , y : Float
    }


updateHovers : Msg -> List Hover -> List Hover
updateHovers msg hovers =
    case msg of
        Hovered key image x y ->
            if List.any (\h -> h.key == key) hovers then
                List.map
                    (\h ->
                        if h.key == key then
                            { h | image = image, x = x, y = y }

                        else
                            h
                    )
                    hovers

            else
                hovers ++ [ { key = key, image = image, x = x, y = y } ]

        Leave key ->
            List.filter (\h -> h.key /= key) hovers

        _ ->
            hovers


{-| The floating previews, positioned so they stay on screen.
-}
previews : { width : Float, height : Float } -> List Hover -> List (Html msg)
previews viewport =
    List.map
        (\h ->
            img
                [ class "card-preview"
                , src h.image
                , alt ""
                , style "left"
                    (px
                        (if h.x + 280 > viewport.width then
                            h.x - 270

                         else
                            h.x + 20
                        )
                    )
                , style "top" (px (max 8 (min (h.y - 60) (viewport.height - 350))))
                ]
                []
        )


px : Float -> String
px n =
    String.fromFloat n ++ "px"


norm : String -> String
norm =
    String.toLower >> String.replace "’" "'" >> String.replace "‘" "'" >> String.trim


{-| Resolves a referenced name to the index: exact, any case, or a double-faced card's front.
-}
indexName : Dict String CardPreview -> String -> String
indexName index =
    let
        byName =
            Dict.foldl
                (\key _ acc ->
                    let
                        front =
                            String.split " // " key |> List.head |> Maybe.withDefault key

                        withKey =
                            Dict.insert (norm key) key acc
                    in
                    if front /= key && not (Dict.member (norm front) withKey) then
                        Dict.insert (norm front) key withKey

                    else
                        withKey
                )
                Dict.empty
                index
    in
    \n -> Dict.get (norm n) byName |> Maybe.withDefault n


{-| Last resort so every card name has a preview: Scryfall serves a card image by exact name.
-}
fallbackPreview : String -> CardLike
fallbackPreview cardName =
    { image = Just ("https://api.scryfall.com/cards/named?exact=" ++ Url.percentEncode cardName ++ "&format=image&version=normal")
    , scryfallUri = "https://scryfall.com/search?q=" ++ Url.percentEncode ("!\"" ++ cardName ++ "\"")
    }


previewOf : Ctx msg -> String -> Maybe CardLike -> CardLike
previewOf ctx cardName card =
    case card of
        Just c ->
            if c.image /= Nothing && c.image /= Just "" then
                c

            else
                fromIndex ctx cardName

        Nothing ->
            fromIndex ctx cardName


fromIndex : Ctx msg -> String -> CardLike
fromIndex ctx cardName =
    case Dict.get cardName ctx.index of
        Just p ->
            { image = p.image, scryfallUri = p.scryfallUri }

        Nothing ->
            fallbackPreview cardName


hrefOf : String -> CardLike -> String
hrefOf cardName data =
    if data.scryfallUri == "" then
        (fallbackPreview cardName).scryfallUri

    else
        data.scryfallUri


{-| The gallery's cards, in order: those without an image are skipped, a repeated name keeps its
first spot.
-}
galleryItems : Dict String CardPreview -> List ( String, Maybe CardLike ) -> List Item
galleryItems index cards =
    let
        ctx =
            { index = index, gallery = Nothing, canHover = False, lift = identity }

        step ( cardName, card ) ( seen, acc ) =
            if List.member cardName seen then
                ( seen, acc )

            else
                let
                    data =
                        previewOf ctx cardName card
                in
                case data.image of
                    Just image ->
                        if image == "" then
                            ( cardName :: seen, acc )

                        else
                            ( cardName :: seen, { name = cardName, image = image, href = hrefOf cardName data } :: acc )

                    Nothing ->
                        ( cardName :: seen, acc )
    in
    List.foldl step ( [], [] ) cards |> Tuple.second |> List.reverse


withGallery : List Item -> Ctx msg -> Ctx msg
withGallery items ctx =
    { ctx | gallery = Just items }


name : Ctx msg -> String -> Html msg
name ctx cardName =
    nameWith ctx { name = cardName, card = Nothing, label = Nothing, class = Nothing, key = Nothing }


{-| A card name with its own card data, label (contents of the link) and class.
-}
nameWith :
    Ctx msg
    ->
        { name : String
        , card : Maybe CardLike
        , label : Maybe (List (Html msg))
        , class : Maybe String
        , key : Maybe String
        }
    -> Html msg
nameWith ctx opts =
    let
        data =
            previewOf ctx opts.name opts.card

        image =
            data.image |> Maybe.andThen nonEmpty

        link =
            hrefOf opts.name data

        key =
            Maybe.withDefault opts.name opts.key

        onTap =
            case image of
                Just _ ->
                    if ctx.canHover then
                        []

                    else
                        let
                            open =
                                case ctx.gallery of
                                    Just items ->
                                        Gallery.focus (\it -> it.name == opts.name) items |> Maybe.map OpenGallery

                                    Nothing ->
                                        Maybe.map (\i -> Open { name = opts.name, image = i, href = link }) image
                        in
                        [ preventDefaultOn "click"
                            (case open of
                                Just msg ->
                                    D.succeed ( ctx.lift msg, True )

                                Nothing ->
                                    -- In a gallery without this card: the tap does nothing.
                                    D.succeed ( ctx.lift (Leave ""), True )
                            )
                        ]

                Nothing ->
                    []

        hover =
            case image of
                Just i ->
                    if ctx.canHover then
                        [ on "mousemove"
                            (D.map2 (\x y -> ctx.lift (Hovered key i x y))
                                (D.field "clientX" D.float)
                                (D.field "clientY" D.float)
                            )
                        ]

                    else
                        []

                Nothing ->
                    []
    in
    span
        (class ("card-name " ++ Maybe.withDefault "" opts.class)
            :: on "mouseleave" (D.succeed (ctx.lift (Leave key)))
            :: hover
        )
        [ a (href link :: target "_blank" :: rel "noreferrer" :: onTap)
            (Maybe.withDefault [ text opts.name ] opts.label)
        ]


nonEmpty : String -> Maybe String
nonEmpty s =
    if s == "" then
        Nothing

    else
        Just s


{-| Several card names, each with its own preview, joined by a separator.
-}
list : Ctx msg -> String -> List String -> List (Html msg)
list ctx separator names =
    List.indexedMap
        (\i n ->
            if i > 0 then
                [ span [ class "muted" ] [ text separator ], name ctx n ]

            else
                [ name ctx n ]
        )
        names
        |> List.concat


{-| Written copy where the cards it references ([[Card Name]]) become previews. Only marked
references do: other words stay words, even ones that are also card names.
-}
prose : Ctx msg -> String -> List (Html msg)
prose ctx value =
    let
        resolve =
            indexName ctx.index
    in
    CardRefs.parts value
        |> List.map
            (\part ->
                case part of
                    CardRefs.Words w ->
                        text w

                    CardRefs.CardRef c ->
                        nameWith ctx { name = resolve c, card = Nothing, label = Just [ text c ], class = Nothing, key = Nothing }
            )


{-| Copy that's still being written: only references the card index knows become previews (the
rest are checked once the text is done), and a reference still being typed isn't shown yet.
-}
proseSoFar : Ctx msg -> String -> List (Html msg)
proseSoFar ctx value =
    let
        resolve =
            indexName ctx.index

        finished =
            case List.reverse (String.indexes "[[" value) of
                last :: _ ->
                    if String.contains "]]" (String.dropLeft last value) then
                        value

                    else
                        String.left last value

                [] ->
                    value
    in
    CardRefs.parts finished
        |> List.map
            (\part ->
                case part of
                    CardRefs.Words w ->
                        text w

                    CardRefs.CardRef c ->
                        if Dict.member (resolve c) ctx.index then
                            nameWith ctx { name = resolve c, card = Nothing, label = Just [ text c ], class = Nothing, key = Nothing }

                        else
                            text c
            )
