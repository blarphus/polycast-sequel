"""
Export fine-tuned sense-picker model to ONNX format for @xenova/transformers.

Produces the directory structure:
  polycast-sense-picker/
    onnx/model.onnx
    config.json
    tokenizer.json
    tokenizer_config.json

Usage:
  python exportOnnx.py [--input-dir ~/Desktop/wiktionary-test/polycast-sense-picker-finetuned]
                       [--output-dir ../../.model-cache/polycast-sense-picker]
"""

import argparse
import os
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir',
                        default=os.path.expanduser('~/Desktop/wiktionary-test/polycast-sense-picker-finetuned'))
    parser.add_argument('--output-dir',
                        default=os.path.join(os.path.dirname(__file__), '..', '.model-cache', 'polycast-sense-picker'))
    parser.add_argument('--quantize', action='store_true', default=True,
                        help='Apply dynamic INT8 quantization')
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()

    print(f"Input model: {input_dir}")
    print(f"Output dir:  {output_dir}")

    # Clean output
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Export to ONNX
    print("\nExporting to ONNX...")
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer

    ort_model = ORTModelForFeatureExtraction.from_pretrained(str(input_dir), export=True)
    tokenizer = AutoTokenizer.from_pretrained(str(input_dir))

    ort_model.save_pretrained(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    if args.quantize:
        print("Quantizing to INT8...")
        from optimum.onnxruntime import ORTQuantizer
        from optimum.onnxruntime.configuration import AutoQuantizationConfig

        quantizer = ORTQuantizer.from_pretrained(str(output_dir))
        qconfig = AutoQuantizationConfig.arm64(is_static=False, per_channel=False)
        quantizer.quantize(save_dir=str(output_dir), quantization_config=qconfig)

        # Remove unquantized model to save space
        unquantized = output_dir / 'onnx' / 'model.onnx'
        if unquantized.exists():
            unquantized.unlink()
            print(f"  Removed unquantized model")

    # Verify output
    print("\nOutput files:")
    for p in sorted(output_dir.rglob('*')):
        if p.is_file():
            size_mb = p.stat().st_size / 1024 / 1024
            print(f"  {p.relative_to(output_dir)} ({size_mb:.1f} MB)")

    print("\nDone!")


if __name__ == '__main__':
    main()
