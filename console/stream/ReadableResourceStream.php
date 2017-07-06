<?php

namespace console\stream;

use Evenement\EventEmitter;
use React\EventLoop\LoopInterface;
use InvalidArgumentException;
use React\Stream\ReadableStreamInterface;
use React\Stream\Util;
use React\Stream\WritableStreamInterface;

class ReadableResourceStream extends EventEmitter implements ReadableStreamInterface {
    /**
     * Controls the maximum buffer size in bytes to read at once from the stream.
     *
     * This value SHOULD NOT be changed unless you know what you're doing.
     *
     * This can be a positive number which means that up to X bytes will be read
     * at once from the underlying stream resource. Note that the actual number
     * of bytes read may be lower if the stream resource has less than X bytes
     * currently available.
     *
     * This can be `null` which means read everything available from the
     * underlying stream resource.
     * This should read until the stream resource is not readable anymore
     * (i.e. underlying buffer drained), note that this does not neccessarily
     * mean it reached EOF.
     *
     * @var int|null
     */
    public $bufferSize = 65536;

    /**
     * @var resource
     */
    public $stream;

    private $closed = false;
    private $loop;

    public function __construct($stream, LoopInterface $loop) {
        if (!is_resource($stream) || get_resource_type($stream) !== "stream") {
            throw new InvalidArgumentException('First parameter must be a valid stream resource');
        }

        // ensure resource is opened for reading (fopen mode must contain "r" or "+")
        $meta = stream_get_meta_data($stream);
        if (isset($meta['mode']) && $meta['mode'] !== '' && strpos($meta['mode'], 'r') === strpos($meta['mode'], '+')) {
            throw new InvalidArgumentException('Given stream resource is not opened in read mode');
        }

        // this class relies on non-blocking I/O in order to not interrupt the event loop
        // e.g. pipes on Windows do not support this: https://bugs.php.net/bug.php?id=47918
        if (stream_set_blocking($stream, 0) !== true) {
            throw new \RuntimeException('Unable to set stream resource to non-blocking mode');
        }

        // Use unbuffered read operations on the underlying stream resource.
        // Reading chunks from the stream may otherwise leave unread bytes in
        // PHP's stream buffers which some event loop implementations do not
        // trigger events on (edge triggered).
        // This does not affect the default event loop implementation (level
        // triggered), so we can ignore platforms not supporting this (HHVM).
        // Pipe streams (such as STDIN) do not seem to require this and legacy
        // PHP < 5.4 causes SEGFAULTs on unbuffered pipe streams, so skip this.
        if (function_exists('stream_set_read_buffer') && !$this->isLegacyPipe($stream)) {
            stream_set_read_buffer($stream, 0);
        }

        $this->stream = $stream;
        $this->loop = $loop;

        $this->resume();
    }

    public function isReadable() {
        return !$this->closed;
    }

    public function pause() {
        $this->loop->removeReadStream($this->stream);
    }

    public function resume() {
        if (!$this->closed) {
            $this->loop->addReadStream($this->stream, array($this, 'handleData'));
        }
    }

    public function pipe(WritableStreamInterface $dest, array $options = []) {
        return Util::pipe($this, $dest, $options);
    }

    public function close() {
        if ($this->closed) {
            return;
        }

        $this->closed = true;

        $this->emit('close');
        $this->loop->removeStream($this->stream);
        $this->removeAllListeners();

        $this->handleClose();
    }

    /** @internal */
    public function handleData() {
        $error = null;
        set_error_handler(function ($errno, $errstr, $errfile, $errline) use (&$error) {
            $error = new \ErrorException(
                $errstr,
                0,
                $errno,
                $errfile,
                $errline
            );
        });

        $data = stream_get_contents($this->stream, $this->bufferSize === null ? -1 : $this->bufferSize);

        restore_error_handler();

        if ($error !== null) {
            $this->emit('error', array(new \RuntimeException('Unable to read from stream: ' . $error->getMessage(), 0, $error)));
            $this->close();
            return;
        }

        if ($data !== '') {
            $this->emit('data', array($data));
        } else {
            // no data read => we reached the end and close the stream
            $this->emit('end');
            $this->close();
        }
    }

    /** @internal */
    public function handleClose() {
        if (is_resource($this->stream)) {
            fclose($this->stream);
        }
    }

    /**
     * Returns whether this is a pipe resource in a legacy environment
     *
     * @param resource $resource
     * @return bool
     *
     * @codeCoverageIgnore
     */
    private function isLegacyPipe($resource) {
        if (PHP_VERSION_ID < 50400) {
            $meta = stream_get_meta_data($resource);

            if (isset($meta['stream_type']) && $meta['stream_type'] === 'STDIO') {
                return true;
            }
        }
        return false;
    }
}