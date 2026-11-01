package io.github.issa13.gradesystem;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * «طباعة / حفظ PDF»: window.print() does nothing inside an Android app, so
 * native-app.js calls this instead. It opens Android's own print screen for
 * the current page (with the page's print styles) — choose «Save as PDF»
 * there, or a printer.
 *
 * Called from JavaScript as Capacitor.Plugins.GradePrint.print({ name: "تقرير" });
 * the promise resolves when the print screen is closed.
 */
@CapacitorPlugin(name = "GradePrint")
public class GradePrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        final String name = call.getString("name", "تقرير");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                final PrintDocumentAdapter page = getBridge().getWebView().createPrintDocumentAdapter(name);
                PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                    @Override
                    public void onStart() {
                        page.onStart();
                    }

                    @Override
                    public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancellationSignal,
                                         LayoutResultCallback callback, Bundle extras) {
                        page.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
                    }

                    @Override
                    public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancellationSignal,
                                        WriteResultCallback callback) {
                        page.onWrite(pages, destination, cancellationSignal, callback);
                    }

                    @Override
                    public void onFinish() {
                        page.onFinish();
                        call.resolve(); // the print screen was closed
                    }
                };
                PrintAttributes a4 = new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                printManager.print(name, adapter, a4);
            } catch (Exception e) {
                call.reject("print failed: " + e.getMessage(), e);
            }
        });
    }
}
