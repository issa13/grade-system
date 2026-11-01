package io.github.issa13.gradesystem;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The website is built by Next.js into one HTML file per page:
 * classes/index.html, student/index.html, … Capacitor, however, answers
 * EVERY address without a file extension (https://localhost/classes/) with
 * the home page's index.html (a setting made for single-page apps). Next.js
 * would then show the wrong page whenever a page is loaded directly — when
 * Android brings the app back after closing it in the background, or after
 * «إعادة تحميل الصفحة».
 *
 * This answers such addresses with the page's own index.html when it exists
 * inside the app, and leaves everything else to Capacitor.
 */
public class GradeWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;

    public GradeWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse page = pageFor(request);
        return page != null ? page : super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse pageFor(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
        if (url.getHost() == null || !url.getHost().equals(bridge.getHost())) return null;
        String path = url.getPath();
        if (path == null || path.equals("/") || path.contains("..")) return null;
        String last = url.getLastPathSegment();
        if (last == null || last.contains(".")) return null; // a file (.js, .css, .txt …)
        String file = "public" + (path.endsWith("/") ? path : path + "/") + "index.html";
        InputStream stream;
        try {
            stream = bridge.getContext().getAssets().open(file);
        } catch (IOException notAPage) {
            return null;
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(
            "text/html",
            "utf-8",
            200,
            "OK",
            headers,
            bridge.getLocalServer().getJavaScriptInjectedStream(stream)
        );
    }
}
