'use strict';

/* globals SyncView, PerfUI */

class SyncView {

  monkepatchSetWindowPosition(viewerInstance) {
    const plzRepeat = _ => setTimeout(_ => this.monkepatchSetWindowPosition(viewerInstance), 100);
    if (typeof PerfUI === 'undefined' || typeof PerfUI.OverviewGrid === 'undefined' ) return plzRepeat();

    PerfUI.OverviewGrid.Window.prototype._setWindowPosition = function(start, end) {
      const overviewGridWindow = this;
      SyncView.setWindowPositionPatch.call(overviewGridWindow, start, end, viewerInstance);
    };
  }

  splitViewTimelineLoaded() {
    return new Promise(resolve => {
      let isLoaded = false;
      const checkLoading = setInterval(() => {
        const timelines = SyncView.timelines();
        for (let Timeline of timelines) {
          const panel = Timeline.TimelinePanel.instance();
          if (panel._state === Timeline.TimelinePanel.State.Idle) {
            isLoaded = true;
          } else {
            isLoaded = false;
            return;
          }
        }
        if (isLoaded) {
          clearInterval(checkLoading);
          resolve();
        }
      }, 500);
    });
  }

  static synchronizeRange(originalPanel, viewerInstance) {
    viewerInstance._originalPanel = originalPanel;
    const tracingModelMinimumRecordTime = originalPanel._performanceModel.tracingModel().minimumRecordTime();
    const tracingModelMaximumRecordTime = originalPanel._performanceModel.tracingModel().maximumRecordTime();
    const referenceDuration = tracingModelMaximumRecordTime - tracingModelMinimumRecordTime;

    const targetPanels = viewerInstance.targetPanels();
    for (let targetPanel of targetPanels) {
      const performanceModel = targetPanel._performanceModel;
      const tracingModel = performanceModel.tracingModel();

      // trace times are trace-specific and not 0-based
      const baseTime = tracingModel.minimumRecordTime();
      tracingModel._maximumRecordTime = Math.min(baseTime + referenceDuration, tracingModel._maximumRecordTime);

      performanceModel.setTracingModel(tracingModel);

      targetPanel._setModel(performanceModel);
    }

    const selectionPcts = {
      start: originalPanel._overviewPane._overviewGrid._window.windowLeft,
      end: originalPanel._overviewPane._overviewGrid._window.windowRight
    };
    viewerInstance._setWindowPosition(selectionPcts);
  }

  /**
   * monkey patched for PerfUI.OverviewGrid.Window.prototype._setWindowPosition
   * @param {?number} start
   * @param {?number} end
   * @param {?Viewer} viewerInstance
   */
  static setWindowPositionPatch(start, end, viewerInstance) {
    // proceed w/ original code for our origin frame
    const selectionPcts = SyncView.originalSetWindowPosition.call(this, start, end);
    this._originalPanel = Timeline.TimelinePanel.instance();
    viewerInstance.syncView._setWindowPosition(selectionPcts);
  }

  _setWindowPosition(selectionPcts) {
    const getSelectionTimes = _ => {
      const originalPanel = this.originalPanel();
      const originTraceStart = originalPanel._overviewPane._overviewCalculator.minimumBoundary();
      const originTraceLengthMs = originalPanel._overviewPane._overviewCalculator.maximumBoundary() - originTraceStart;

      // calculate the selectionStart offset of origin frame
      const originSelectionStartMs = selectionPcts.start * originTraceLengthMs;
      const originSelectionDurationMs = (selectionPcts.end - selectionPcts.start) * originTraceLengthMs;
      return {
        start: originSelectionStartMs,
        duration: originSelectionDurationMs
      };
    };

    const selectionMs = getSelectionTimes();

    // calculate what target frames should be:

    const targetPanels = this.targetPanels();
    for (let targetPanel of targetPanels) {
      const absoluteMin = targetPanel._overviewPane._overviewCalculator.minimumBoundary();
      const targetTraceLengthMs = targetPanel._overviewPane._overviewCalculator.maximumBoundary() - absoluteMin;

      const windowPercentages = {
        left: selectionMs.start / targetTraceLengthMs,
        right: (selectionMs.start + selectionMs.duration) / targetTraceLengthMs
      };
      // call it on the frame's PerfUI.OverviewGrid.Window
      targetPanel._overviewPane._overviewGrid._window._setWindow(windowPercentages.left, windowPercentages.right);
    }
  }

  /**
   * No significant changes from the real thing, except adding a return value
   *   https://github.com/ChromeDevTools/devtools-frontend/blob/3becf6724b90a6a4cd41b2cf10f053c7efd166fe/front_end/perf_ui/OverviewGrid.js#L357-L366
   * @param {?number} start
   * @param {?number} end
   * @param {*}
   */
  static originalSetWindowPosition(start, end) {
    const clientWidth = this._parentElement.clientWidth;
    const windowLeft = typeof start === 'number' ? start / clientWidth : this.windowLeft;
    const windowRight = typeof end === 'number' ? end / clientWidth : this.windowRight;
    this._setWindow(windowLeft, windowRight);

    return {
      start: windowLeft,
      end: windowRight
    };
  }

  static timelines() {
    const frames = window.parent.document.getElementsByTagName('frame');
    return Array.from(frames)
      .map(frame => frame.contentWindow['Timeline']);
  }

  static panels() {
    const timelines = SyncView.timelines();
    return timelines.map(Timeline => Timeline.TimelinePanel.instance());
  }

  originalPanel() {
    if (!this._originalPanel)
      this._originalPanel = Timeline.TimelinePanel.instance();

    return this._originalPanel;
  }

  targetPanels() {
    return SyncView.panels().filter(panel => panel !== this.originalPanel());
  }

}
