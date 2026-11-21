module Route exposing (DeckView(..), Route(..), deckHref, decoder, href)

{-| The app's pages. The URL itself is read and written in src/nav.ts (shared with the static
build); this mirrors `routeHref` in src/routes.ts for the links the app draws.
-}

import Json.Decode as D exposing (Decoder)


type DeckView
    = Current
    | Optimized


type Route
    = Home
    | Deck String DeckView
    | Job String String
    | Run String


{-| Where a route lives. The published site uses real paths (decks/<slug>/), each one a page with
the report in plain HTML, so a copied link works for readers that don't run JavaScript. The local
app keeps hash routes.
-}
href : Bool -> Route -> String
href isStatic route =
    case route of
        Job slug jobId ->
            "#/job/" ++ slug ++ "/" ++ jobId

        Home ->
            if isStatic then
                "./"

            else
                "#/"

        Run slug ->
            if isStatic then
                "decks/" ++ slug ++ "/run/"

            else
                "#/deck/" ++ slug ++ "/run"

        Deck slug view ->
            let
                parts =
                    case view of
                        Optimized ->
                            slug ++ "/optimized"

                        Current ->
                            slug
            in
            if isStatic then
                "decks/" ++ parts ++ "/"

            else
                "#/deck/" ++ parts


deckHref : Bool -> String -> DeckView -> String
deckHref isStatic slug view =
    href isStatic (Deck slug view)


{-| A route as src/routes.ts describes it: `{ page, slug, view, jobId }`.
-}
decoder : Decoder Route
decoder =
    D.field "page" D.string
        |> D.andThen
            (\page ->
                case page of
                    "deck" ->
                        D.map2 Deck
                            (D.field "slug" D.string)
                            (D.field "view" D.string
                                |> D.map
                                    (\v ->
                                        if v == "optimized" then
                                            Optimized

                                        else
                                            Current
                                    )
                            )

                    "job" ->
                        D.map2 Job (D.field "slug" D.string) (D.field "jobId" D.string)

                    "run" ->
                        D.map Run (D.field "slug" D.string)

                    _ ->
                        D.succeed Home
            )
