var x11 = require('..');
// TODO: move to templates

function parse_rectangle(buf, pos) {
    if (!pos) {
        pos = 0;
    }

    return {
        x : buf[pos],
        y : buf[pos + 1],
        width : buf[pos + 2],
        height : buf[pos + 3]
    }
}

exports.requireExt = function(display, callback)
{
    var X = display.client;
    X.QueryExtension('XFIXES', function(err, ext) {

        if (!ext.present)
            return callback(new Error('extension not available'));

        ext.QueryVersion = function(clientMaj, clientMin, callback)
        {
            X.seq_num++;
            X.pack_stream.pack('CCSLL', [ext.majorOpcode, 0, 3, clientMaj, clientMin]);
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    var res = buf.unpack('LL');
                    return res;
                },
                callback
            ];
            X.pack_stream.flush();
        }

        ext.SaveSetMode = { Insert: 0, Delete: 1 };
        ext.SaveSetTarget = { Nearest: 0, Root: 1 };
        ext.SaveSetMap = { Map: 0, Unmap: 1 };

        ext.ChangeSaveSet = function(window, mode, target, map) {
            X.seq_num++;
            X.pack_stream.pack('CCSCCxL', [ext.majorOpcode, 1, 3, mode, target, map]);
            X.pack_stream.flush();
        };
        
        // ==========================================================
        // ===== BẮT ĐẦU ĐOẠN CODE TRIỂN KHAI GETCURSORIMAGE ========
        // ==========================================================

        ext.GetCursorImage = function(callback) {
            X.seq_num++;
            // Gửi yêu cầu GetCursorImage
            // Opcode của GetCursorImage là 4
            // Request Length: 1 (vì gói tin yêu cầu chỉ có 4 bytes)
            X.pack_stream.pack('CCS', [ext.majorOpcode, 4, 1]);

            X.replies[X.seq_num] = [
                function(buf, opt) {
                    // Giải mã gói tin phản hồi theo định dạng trong tài liệu:
                    //   x:            INT16   (s)
                    //   y:            INT16   (s)
                    //   width:        CARD16  (S)
                    //   height:       CARD16  (S)
                    //   x-hot:        CARD16  (S)
                    //   y-hot:        CARD16  (S)
                    //   cursor-serial:CARD32  (L)
                    // Tổng cộng 16 bytes cho phần header của dữ liệu.
                    var res = buf.unpack('ssSSSSL');

                    var result = {
                        x: res[0],
                        y: res[1],
                        width: res[2],
                        height: res[3],
                        xhot: res[4], // hotspot X
                        yhot: res[5], // hotspot Y
                        cursorSerial: res[6],
                        // Dữ liệu hình ảnh (cursor-image) là phần còn lại của buffer.
                        // Đây là một buffer chứa các pixel 32-bit (ARGB, đã nhân trước alpha).
                        cursorImage: buf.slice(16)
                    };
                    
                    return result;
                },
                callback
            ];

            X.pack_stream.flush();
        };
        
        // ========================================================
        // ===== KẾT THÚC ĐOẠN CODE TRIỂN KHAI GETCURSORIMAGE =====
        // ========================================================


        ext.WindowRegionKind = {
            Bounding : 0,
            Clip : 1
        };

        ext.CreateRegion = function(region, rects) {
            X.seq_num ++;
            var format = 'CCSL';
            format += Array(rects.length + 1).join('ssSS');
            var args = [ ext.majorOpcode, 5, 2 + (rects.length << 1), region ];
            rects.forEach(function(rect) {
                args.push(rect.x);
                args.push(rect.y);
                args.push(rect.width);
                args.push(rect.height);
            });

            X.pack_stream.pack(format, args);
            X.pack_stream.flush();
        }

        ext.CreateRegionFromWindow = function(region, wid, kind) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLLCxxx', [ ext.majorOpcode, 7, 4, region, wid, kind ]);
            X.pack_stream.flush();
        }

        ext.DestroyRegion = function(region) {
            X.seq_num ++;
            X.pack_stream.pack('CCSL', [ ext.majorOpcode, 10, 2, region ]);
            X.pack_stream.flush();
        }

        ext.UnionRegion = function(src1, src2, dst) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLLL', [ ext.majorOpcode, 13, 4, src1, src2, dst ]);
            X.pack_stream.flush();
        }

        ext.TranslateRegion = function(region, dx, dy) {
            X.seq_num ++;
            X.pack_stream.pack('CCSLss', [ ext.majorOpcode, 17, 3, region, dx, dy ]);
            X.pack_stream.flush();
        }

        ext.FetchRegion = function(region, cb) {
            X.seq_num ++;
            X.pack_stream.pack('CCSL', [ ext.majorOpcode, 19, 2, region ]);
            X.replies[X.seq_num] = [
                function(buf, opt) {
                    var n_rectangles = (buf.length - 24) >> 3;
                    var format = 'ssSSxxxxxxxxxxxxxxxx';
                    format += Array(n_rectangles + 1).join('ssSS');
                    var res = buf.unpack(format);
                    var reg = {
                        extents : parse_rectangle(res),
                        rectangles : []
                    };

                    for (var i = 0; i < n_rectangles; ++ i) {
                        reg.rectangles.push(parse_rectangle(res, 4 + (i << 2)));
                    }

                    return reg;
                },
                cb
            ];

            X.pack_stream.flush();
        }

        ext.QueryVersion(5, 0, function(err, vers) {
            if (err)
                return callback(err);
            ext.major = vers[0];
            ext.minor = vers[1];
            callback(null, ext);
        });

        ext.events = {
            DamageNotify: 0
        }

        X.eventParsers[ext.firstEvent + ext.events.DamageNotify] = function(type, seq, extra, code, raw)
        {
            var event = {};
            event.level = code;
            event.seq = seq;
            event.drawable = extra;
            var values = raw.unpack('LLssSSssSS');
            event.damage = values[0];
            event.time = values[1];
            event.area = {
              x: values[2],
              y: values[3],
              w: values[4],
              h: values[5]
            };
            event.geometry = {
              x: values[6],
              y: values[7],
              w: values[8],
              h: values[9]
            };
            event.name = 'DamageNotify';
            return event;
        };
    });
}
