module Route exposing (DeckView(..), Route(..), deckHref, decoder, href)

{-| The app's pages. The URL itself is read and written in src/web/nav.ts (shared with the static
build); this mirrors `routeHref` in src/web/routes.ts for the links the app draws.
-}

import Json.Decode as D exposing (Decoder)
import Site exposing (Site(..))
import Types exposing (Slug, slugDecoder, slugToString)


type DeckView
    = Current
    | Optimized


type Route
    = Home
      -- Checking the cards read from a photo or list, before the deck is saved (local app only).
    | Review
    | Deck Slug DeckView
    | Job Slug String
    | Run Slug


{-| Where a route lives. The published site uses real paths (decks/<slug>/), each one a page with
the report in plain HTML, so a copied link works for readers that don't run JavaScript. The local
app keeps hash routes.
-}
href : Site -> Route -> String
href site route =
    case ( route, site ) of
        ( Job slug jobId, _ ) ->
            "#/job/" ++ slugToString slug ++ "/" ++ jobId

        ( Home, Published ) ->
            "./"

        ( Home, Local ) ->
            "#/"

        ( Review, _ ) ->
            "#/review"

        ( Run slug, Published ) ->
            "decks/" ++ slugToString slug ++ "/run/"

        ( Run slug, Local ) ->
            "#/deck/" ++ slugToString slug ++ "/run"

        ( Deck slug view, _ ) ->
            let
                parts =
                    case view of
                        Optimized ->
                            slugToString slug ++ "/optimized"

                        Current ->
                            slugToString slug
            in
            case site of
                Published ->
                    "decks/" ++ parts ++ "/"

                Local ->
                    "#/deck/" ++ parts


deckHref : Site -> Slug -> DeckView -> String
deckHref site slug view =
    href site (Deck slug view)


{-| A route exactly as src/web/routes.ts describes it (`{ page, slug, view, jobId }`): any other
page or view is a mistake there, not a route to guess at.
-}
decoder : Decoder Route
decoder =
    D.field "page" D.string
        |> D.andThen
            (\page ->
                case page of
                    "home" ->
                        D.succeed Home

                    "review" ->
                        D.succeed Review

                    "deck" ->
                        D.map2 Deck (D.field "slug" slugDecoder) (D.field "view" viewDecoder)

                    "job" ->
                        D.map2 Job (D.field "slug" slugDecoder) (D.field "jobId" D.string)

                    "run" ->
                        D.map Run (D.field "slug" slugDecoder)

                    _ ->
                        D.fail ("Unknown page: " ++ page)
            )


viewDecoder : Decoder DeckView
viewDecoder =
    D.string
        |> D.andThen
            (\view ->
                case view of
                    "current" ->
                        D.succeed Current

                    "optimized" ->
                        D.succeed Optimized

                    _ ->
                        D.fail ("Unknown deck view: " ++ view)
            )
