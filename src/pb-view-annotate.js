import '@polymer/paper-icon-button';
import tippy from 'tippy.js';
import { PbView } from "./pb-view.js";
import { loadTippyStyles } from "./pb-popover.js";

/**
 * Return the first child of ancestor which contains current.
 * Used to adjust nested anchor points.
 * 
 * @param {Node} current the anchor node
 * @param {Node} ancestor the context ancestor node
 * @returns {Node} first child of ancestor containing current
 */
function extendRange(current, ancestor) {
  let parent = current;
  while (parent.parentNode !== ancestor) {
    parent = parent.parentElement;
  }
  return parent;
}

/**
 * Check if the nodeToCheck should be ignored when computing offsets.
 * Applies e.g. to footnote markers.
 * 
 * @param {Node} nodeToCheck the node to check
 * @returns true if node should be ignored
 */
function isSkippedNode(nodeToCheck) {
  let node = nodeToCheck;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }
  const href = /** @type {Element} */ (node).getAttribute('href');
  return href && /^#fn_.*$/.test(href);
}

/**
 * For a given HTML node, compute the number of characters from the start
 * of the parent element.
 *
 * @param {Node} node the node for which to compute an absolute offset
 * @param {Number} offset start offset
 * @returns {Number} absolute offset
 */
function absoluteOffset(container, node, offset) {
  const walker = document.createTreeWalker(container);
  walker.currentNode = node;
  while (walker.previousNode()) {
    const sibling = walker.currentNode;
    if (!(sibling.nodeType === Node.ELEMENT_NODE || isSkippedNode(sibling))) {
      // eslint-disable-next-line no-param-reassign
      offset += sibling.textContent.length;
    }
  }
  return offset;
}

/**
 * Convert the start or end boundary of a browser range by computing
 * the number of characters from the start of the parent element.
 *
 * @param {Node} node input node
 * @param {Number} offset offset relative to the parent element
 * @returns
 */
function rangeToPoint(node, offset, position = 'start') {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const container = /** @type {Element} */ (node).closest('[data-tei]');
    if (offset === 0) {
      return {
        parent: container.getAttribute('data-tei'),
        offset: 0,
      };
    }
    const child = container.childNodes[offset];
    return {
      parent: container.getAttribute('data-tei'),
      offset: position === 'end' ? absoluteOffset(container, child, 0) - 1 : absoluteOffset(container, child, 0),
    };
  }
  const container = /** @type {Element} */ (node.parentNode).closest('[data-tei]');
  if (container) {
    return {
      parent: container.getAttribute('data-tei'),
      offset: absoluteOffset(container, node, offset),
    };
  } else {
    console.error('No container with data-tei found for %o', node.parentNode);
  }
}

function ancestors(node, selector) {
  let count = 0;
  let parent = node.parentNode;
  while (parent && parent !== node.getRootNode()) {
    if (parent.classList.contains(selector)) {
      count += 1;
    }
    parent = parent.parentNode;
  }
  return count;
}

/**
 * Convert a point given as number of characters from the start of the container element
 * to a coordinate relative to a DOM element.
 *
 * @param {Node} container the container element
 * @param {*} offset absolute offset
 * @returns
 */
function pointToRange(container, offset) {
  let relOffset = offset;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (relOffset - walker.currentNode.textContent.length <= 0) {
      return [walker.currentNode, relOffset];
    }
    if (!isSkippedNode(walker.currentNode)) {
      relOffset -= walker.currentNode.textContent.length;
    }
  }
  return null;
}

/**
 * Clear all markers
 * 
 * @param {HTMLElement} root 
 */
function clearMarkers(root) {
  root.querySelectorAll('.marker').forEach(marker => marker.parentNode.removeChild(marker));
}

function kwicText(str, start, end, words = 3) {
  let p0 = start - 1;
  let count = 0;
  while (p0 >= 0) {
    if (/[\p{P}\s]/.test(str.charAt(p0))) {
      while (p0 > 1 && /[\p{P}\s]/.test(str.charAt(p0 - 1))) {
        p0 -= 1;
      }
      count += 1;
      if (count === words) {
        break;
      }
    }
    p0 -= 1;
  }
  let p1 = end + 1;
  count = 0;
  while (p1 < str.length) {
    if (/[\p{P}\s]/.test(str.charAt(p1))) {
      while (p1 < str.length - 1 && /[\p{P}\s]/.test(str.charAt(p1 + 1))) {
        p1 += 1;
      }
      count += 1;
      if (count === words) {
        break;
      }
    }
    p1 += 1;
  }
  return `... ${str.substring(p0, start)}<mark>${str.substring(start, end)}</mark>${str.substring(end, p1 + 1)} ...`;
}

function collectText(node) {
  let parent = node.parentElement;
  if (parent.textContent.length < 40) {
    parent = parent.parentNode;
  }
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let start = 0;
  const str = [];
  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      start = offset;
    }
    offset += walker.currentNode.textContent.length;
    str.push(walker.currentNode.textContent);
  }
  return [str.join(''), start];
}

/**
 * An extended `PbView`, which supports annotations to be added
 * and edited by the user. Handles mouse selection and keeps track
 * of the annotations made.
 * 
 * Interaction with the actual editing form is entirely done via events.
 * The class itself does not provide any editing facility, except for
 * handling deletions.
 * 
 * @fires pb-selection-changed - fired when user selects text
 * @fires pb-annotations-changed - fired when an annotation was added or changed
 * @fires pb-annotation-detail - fired to request additional details about an annotation
 */
class PbViewAnnotate extends PbView {
  static get properties() {
    return {
      key: {
        type: String
      },
      ...super.properties,
    };
  }

  constructor() {
    super();
    this.key = 'ref';
    this._ranges = [];
    this._rangesMap = new Map();
  }

  connectedCallback() {
    super.connectedCallback();

    let isMouseDown = false;

    this._inHandler = false;
    this._pendingCallback = null;

    const scheduleCallback = (delay = 10) => {
      this._pendingCallback = setTimeout(() => {
        this._selectionChanged();
      }, delay);
    };

    /** @param {Event} event */
    this._eventHandler = event => {
      if (event.type === 'selectionchange' && this._inHandler) {
        return;
      }
      if (event.type === 'mousedown') {
        isMouseDown = true;
      }
      if (event.type === 'mouseup') {
        isMouseDown = false;
      }

      // If the user makes a selection with the mouse, wait until they release
      // it before reporting a selection change.
      if (isMouseDown) {
        return;
      }

      this._cancelPendingCallback();

      // Schedule a notification after a short delay. The delay serves two
      // purposes:
      //
      // - If this handler was called as a result of a 'mouseup' event then the
      //   selection will not be updated until the next tick of the event loop.
      //   In this case we only need a short delay.
      //
      // - If the user is changing the selection with a non-mouse input (eg.
      //   keyboard or selection handles on mobile) this buffers updates and
      //   makes sure that we only report one when the update has stopped
      //   changing. In this case we want a longer delay.

      const delay = event.type === 'mouseup' ? 10 : 100;
      scheduleCallback(delay);
    };

    document.addEventListener('selectionchange', this._eventHandler.bind(this));
    this.shadowRoot.addEventListener('mousedown', this._eventHandler.bind(this));
    this.shadowRoot.addEventListener('mouseup', this._eventHandler.bind(this));

    this.subscribeTo('pb-refresh', () => {
      this._ranges = [];
      this._rangesMap.clear();
      this._currentSelection = null;
      clearMarkers(this.shadowRoot.getElementById('view'));
      this.emitTo('pb-annotations-changed', { ranges: this._ranges });
    });

    this.subscribeTo('pb-add-annotation', ev => this.addAnnotation(ev.detail));
    this.subscribeTo('pb-edit-annotation', this._editAnnotation.bind(this));
  }

  get annotations() {
    return this._ranges;
  }

  firstUpdated() {
    super.firstUpdated();

    loadTippyStyles(this.shadowRoot, 'light-border');
  }

  _handleContent() {
    super._handleContent();
    this.updateComplete.then(() => setTimeout(() => this.updateAnnotations(), 300));
  }

  _updateAnnotation(teiRange) {
    const view = this.shadowRoot.getElementById('view');
    const context = Array.from(view.querySelectorAll(`[data-tei="${teiRange.context}"]`)).filter(
      node => node.closest('pb-popover') === null && node.getAttribute('rel') !== 'footnote',
    )[0];

    if (!context) {
      return null;
    }

    const range = document.createRange();

    const startPoint = pointToRange(context, teiRange.start);
    const endPoint = pointToRange(context, teiRange.end);
    if (!(startPoint && endPoint)) {
      console.error('<pb-view-annotate> Invalid range for %o', context);
      return null;
    }

    console.log('<pb-view-annotate> Range before adjust: %o %o', startPoint, endPoint);
    if (startPoint[0] !== endPoint[0] && startPoint[1] === 0) {
      range.setStartBefore(extendRange(startPoint[0], context));
    } else {
      range.setStart(startPoint[0], startPoint[1]);
    }

    if (startPoint[0] !== endPoint[0] && endPoint[0].textContent.length - 1 === endPoint[1]) {
      range.setEndAfter(extendRange(endPoint[0], context));
    } else {
      range.setEnd(endPoint[0], endPoint[1]);
    }

    console.log('<pb-view-annotate> Range: %o', range);
    const span = document.createElement('span');
    span.className = `annotation annotation-${teiRange.type} ${teiRange.type}`;
    span.dataset.annotation = JSON.stringify({
      type: teiRange.type,
      properties: teiRange.properties,
    });
    // span.appendChild(range.extractContents());

    range.surroundContents(span);
    this._rangesMap.set(span, teiRange);
    // range.insertNode(span);

    this._showMarkers();

    return span;
  }

  updateAnnotations() {
    this._ranges.forEach(this._updateAnnotation.bind(this));
    this._showMarkers();
  }

  _selectionChanged() {
    const selection = this.shadowRoot.getSelection();
    const range = this._selectedRange(selection);
    if (range) {
      let changed = false;
      const ancestor = range.commonAncestorContainer;
      if (ancestor.nodeType === Node.ELEMENT_NODE) {
        if (range.startContainer.parentElement !== ancestor) {
          const parent = extendRange(range.startContainer, ancestor);
          range.setStartBefore(parent);
          changed = true;
        }
        if (range.endContainer.parentElement !== ancestor) {
          const parent = extendRange(range.endContainer, ancestor);
          range.setEndAfter(parent);
          changed = true;
        }
      }
      this._currentSelection = range;
      console.log('<pb-view-annotate> selection: %o', range);

      if (changed) {
        this._inHandler = true;
        setTimeout(() => {
          selection.removeAllRanges();
          selection.addRange(range);
          this.inHandler = false;
        }, 100);
      }

      this.emitTo('pb-selection-changed', { hasContent: true, range });
    } else {
      this.emitTo('pb-selection-changed', { hasContent: false });
    }
  }

  updateAnnotation(teiRange) {
    const result = this._updateAnnotation(teiRange);
    if (result) {
      this._ranges.push(teiRange);
      this.emitTo('pb-annotations-changed', {
        type: teiRange.type,
        text: teiRange.text,
        ranges: this._ranges,
      });
    }
    return result;
  }

  addAnnotation(info) {
    const range = info.range || this._currentSelection;
    const startRange = rangeToPoint(range.startContainer, range.startOffset);
    const endRange = rangeToPoint(range.endContainer, range.endOffset, 'end');
    const adjustedRange = {
      context: startRange.parent,
      start: startRange.offset,
      end: endRange.offset,
      text: range.cloneContents().textContent,
    };
    if (info.type) {
      adjustedRange.type = info.type;
    }
    if (info.properties) {
      adjustedRange.properties = info.properties;
    }
    console.log('<pb-view-annotate> range adjusted: %o', adjustedRange);
    this._ranges.push(adjustedRange);
    this.emitTo('pb-annotations-changed', {
      type: adjustedRange.type,
      text: adjustedRange.text,
      ranges: this._ranges,
    });
    return this._updateAnnotation(adjustedRange);
  }

  deleteAnnotation(span) {
    // delete an existing annotation element in the TEI source
    if (span.dataset.tei) {
      // first check if we have pending modifications and remove them
      const idx = this._ranges.findIndex(r => r.type === 'modify' && r.node === span.dataset.tei);
      if (idx > -1) {
        this._ranges.splice(idx, 1);
      }

      const context = span.parentNode.closest('[data-tei]');
      const range = {
        type: 'delete',
        node: span.dataset.tei,
        context: context.dataset.tei,
      };
      this._ranges.push(range);
    } else {
      const teiRange = this._rangesMap.get(span);
      this._rangesMap.delete(span);
      const pos = this._ranges.indexOf(teiRange);

      console.log('<pb-view-annotate> deleting annotation %o', teiRange);

      this._ranges.splice(pos, 1);
    }

    for (let i = 0; i < span.childNodes.length; i++) {
      const copy = span.childNodes[i].cloneNode(true);
      span.parentNode.insertBefore(copy, span);
    }
    span.parentNode.removeChild(span);

    this.emitTo('pb-annotations-changed', { ranges: this._ranges });

    this._showMarkers();
  }

  editAnnotation(span, properties) {
    if (span.dataset.tei) {
      // TODO: check in _ranges if it has already been modified
      const context = span.closest('[data-tei]');
      let range = this._ranges.find(r => r.type === 'modify' && r.node === span.dataset.tei);
      if (!range) {
        range = {
          type: 'modify',
          node: span.dataset.tei,
          context: context.dataset.tei,
        };
        this._ranges.push(range);
      }
      range.properties = properties;

      this.emitTo('pb-annotations-changed', { ranges: this._ranges });
    }

    const json = JSON.parse(span.dataset.annotation);
    json.properties = properties;
    span.dataset.annotation = JSON.stringify(json);
  }

  _editAnnotation(ev) {
    this.editAnnotation(ev.detail.target, ev.detail.properties);
  }

  /**
   *
   * @returns {Range|null} the selected range, if any
   */
  _selectedRange(selection) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    if (selection.anchorNode.getRootNode() !== this.shadowRoot) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      return null;
    }
    return range;
  }

  _cancelPendingCallback() {
    if (this._pendingCallback) {
      clearTimeout(this._pendingCallback);
      this._pendingCallback = null;
    }
  }

  _createTooltip(root, span) {
    if (span._tippy) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'annotation-popup';
    const info = document.createElement('div');
    info.className = 'info';
    wrapper.appendChild(info);

    const div = document.createElement('div');
    div.className = 'toolbar';

    const typeInd = document.createElement('span');
    typeInd.className = 'annotation-type';
    div.appendChild(typeInd);

    if (span.dataset.annotation) {
      const editBtn = document.createElement('paper-icon-button');
      editBtn.setAttribute('icon', 'icons:create');
      editBtn.addEventListener('click', () => {
        const json = span.dataset.annotation;
        const data = JSON.parse(json);
        this.emitTo('pb-annotation-edit', Object.assign({}, data, { target: span }));
      });
      div.appendChild(editBtn);
    }
    const delBtn = document.createElement('paper-icon-button');
    delBtn.setAttribute('icon', 'icons:delete');
    delBtn.addEventListener('click', () => {
      this.deleteAnnotation(span);
    });
    div.appendChild(delBtn);
    wrapper.appendChild(div);

    tippy(span, {
      content: wrapper,
      allowHTML: true,
      interactive: true,
      appendTo: root.nodeType === Node.DOCUMENT_NODE ? document.body : root,
      theme: 'light-border',
      hideOnClick: false,
      onShow: () => {
        if (!span.dataset.annotation) {
          return;
        }
        const data = JSON.parse(span.dataset.annotation);
        typeInd.innerHTML = data.type;
        this.emitTo('pb-annotation-detail', {
          type: data.type,
          id: data.properties[this.key],
          container: info,
          span,
        });
      },
    });
  }

  /**
   * Create a marker for an annotation. Position it absolute next to the annotation.
   *
   * @param {Element} span the span for which to display the marker
   * @param {Element} root element with relative position
   * @param {Number} margin additional margin to avoid overlapping markers
   */
  _showMarker(span, root, margin = 0) {
    const rootRect = root.getBoundingClientRect();
    const rects = span.getClientRects();
    const type = Array.from(span.classList.values())
      .filter(cl => /^annotation-.*$/.test(cl))
      .join('');
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const marker = document.createElement('div');
      marker.className = `marker ${type}`;
      marker.style.position = 'absolute';
      marker.style.left = `${rect.left - rootRect.left}px`;
      marker.style.top = `${rect.top - rootRect.top + rect.height}px`;
      marker.style.marginTop = `${margin}px`;
      marker.style.width = `${rect.width}px`;
      marker.style.height = `3px`;
      marker.style.backgroundColor = `var(--pb-${type})`;
      marker.part = 'annotation';
      root.appendChild(marker);
    }

    this._createTooltip(root, span);
  }

  /**
   * For all annotations currently shown, create a marker element and position
   * it absolute next to the annotation
   *
   * @param {HTMLElement} root element containing the markers
   */
  _showMarkers() {
    const root = this.shadowRoot.getElementById('view');
    clearMarkers(root);
    Array.from(root.querySelectorAll('.annotation'))
      .reverse()
      .forEach(span => {
        this._showMarker(span, root, ancestors(span, 'annotation') * 5);
      });
  }

  search(type, tokens) {
    function filter(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return NodeFilter.FILTER_ACCEPT;
      }
      if (node.classList.contains('annotation-popup')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    }
    filter.acceptNode = filter;

    const result = [];
    if (!tokens || tokens.length === 0) {
      return result;
    }
    const expr = tokens.map(token => `\\b${token.replace(/[\s\n\t]+/g, '\\s+')}\\b`).join('|');
    const regex = new RegExp(expr, 'gi');
    const walker = document.createTreeWalker(
      this.shadowRoot.getElementById('view'),
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      filter,
    );
    while (walker.nextNode()) {
      let node = walker.currentNode;
      const matches = Array.from(node.textContent.matchAll(regex));
      for (const match of matches) {
        const end = match.index + match[0].length;
        let isAnnotated = false;
        let ref = null;
        const annoData = node.parentNode.dataset.annotation;
        if (annoData) {
          const parsed = JSON.parse(annoData);
          isAnnotated = parsed.type === type;
          ref = parsed.properties[this.key];
        }

        const startRange = rangeToPoint(node, match.index);
        const endRange = rangeToPoint(node, end, 'end');

        const [str, start] = collectText(node);
        const entry = {
          annotated: isAnnotated,
          context: startRange.parent,
          start: startRange.offset,
          end: endRange.offset,
          textNode: node,
          kwic: kwicText(str, start + match.index, start + end),
        };
        entry[this.key] = ref;
        result.push(entry);
      }
    }
    return result;
  }

  scrollTo(teiRange) {
    const root = this.shadowRoot.getElementById('view');
    const range = document.createRange();
    if (teiRange.annotated) {
      range.selectNode(teiRange.textNode);
    } else {
      const context = Array.from(root.querySelectorAll(`[data-tei="${teiRange.context}"]`)).filter(
        node => node.closest('pb-popover') === null && node.getAttribute('rel') !== 'footnote',
      )[0];
      const startPoint = pointToRange(context, teiRange.start);
      const endPoint = pointToRange(context, teiRange.end);
      range.setStart(startPoint[0], startPoint[1]);
      range.setEnd(endPoint[0], endPoint[1]);
    }

    const rootRect = root.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    let marker = root.querySelector('[part=highlight]');
    if (!marker) {
      marker = document.createElement('div');
      marker.part = 'highlight';
      marker.style.position = 'absolute';
      root.appendChild(marker);
    }

    marker.style.left = `${rect.left - rootRect.left}px`;
    marker.style.top = `${rect.top - rootRect.top - 4}px`;
    marker.style.width = `${rect.width}px`;
    marker.style.height = `${rect.height}px`;

    range.startContainer.parentNode.scrollIntoView(true);
  }

  hideMarker() {
    const root = this.shadowRoot.getElementById('view');
    const marker = root.querySelector('[part=highlight]');
    if (marker) {
      marker.style.top = '-1000px';
    }
  }
};

customElements.define('pb-view-annotate', PbViewAnnotate);