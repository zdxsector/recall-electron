const RESIZE_IDLE_MS = 160;
const RESIZE_IMAGE_SELECTOR =
  '.muya-editor-root img, .note-list-item-thumb-img';
const RESIZING_CLASS = 'is-window-resizing';

type FrozenImage = HTMLImageElement & {
  dataset: DOMStringMap & {
    recallResizeHeight?: string;
    recallResizeMaxHeight?: string;
    recallResizeMaxWidth?: string;
    recallResizeWidth?: string;
  };
};

const freezeImage = (image: HTMLImageElement) => {
  const frozen = image as FrozenImage;
  if (frozen.dataset.recallResizeWidth !== undefined) {
    return;
  }

  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  frozen.dataset.recallResizeWidth = image.style.width;
  frozen.dataset.recallResizeHeight = image.style.height;
  frozen.dataset.recallResizeMaxWidth = image.style.maxWidth;
  frozen.dataset.recallResizeMaxHeight = image.style.maxHeight;

  image.style.width = `${Math.round(rect.width)}px`;
  image.style.height = `${Math.round(rect.height)}px`;
  image.style.maxWidth = 'none';
  image.style.maxHeight = 'none';
};

const releaseImage = (image: HTMLImageElement) => {
  const frozen = image as FrozenImage;
  if (frozen.dataset.recallResizeWidth === undefined) {
    return;
  }

  image.style.width = frozen.dataset.recallResizeWidth;
  image.style.height = frozen.dataset.recallResizeHeight ?? '';
  image.style.maxWidth = frozen.dataset.recallResizeMaxWidth ?? '';
  image.style.maxHeight = frozen.dataset.recallResizeMaxHeight ?? '';

  delete frozen.dataset.recallResizeWidth;
  delete frozen.dataset.recallResizeHeight;
  delete frozen.dataset.recallResizeMaxWidth;
  delete frozen.dataset.recallResizeMaxHeight;
};

export const createWindowResizePerformanceController = (
  doc: Document = document
) => {
  let resizeIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const freezeImages = () => {
    doc.body?.classList.add(RESIZING_CLASS);
    doc
      .querySelectorAll<HTMLImageElement>(RESIZE_IMAGE_SELECTOR)
      .forEach(freezeImage);
  };

  const releaseImages = () => {
    resizeIdleTimer = null;
    doc
      .querySelectorAll<HTMLImageElement>(RESIZE_IMAGE_SELECTOR)
      .forEach(releaseImage);
    doc.body?.classList.remove(RESIZING_CLASS);
  };

  return {
    handleResize() {
      freezeImages();

      if (resizeIdleTimer) {
        clearTimeout(resizeIdleTimer);
      }

      resizeIdleTimer = setTimeout(releaseImages, RESIZE_IDLE_MS);
    },
  };
};
