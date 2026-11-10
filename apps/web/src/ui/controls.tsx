import {
  Button as AntButton,
  Input as AntInput,
  Select as AntSelect,
  Slider as AntSlider,
  Upload as AntUpload,
  Card as AntCard,
  List as AntList,
  type ButtonProps,
  type SelectProps,
  type UploadProps,
} from "antd";
import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/** 用 Ant Button 统一全站按钮语义，同时保留原生表单按钮类型与现有样式类。 */
export type UiButtonProps = Omit<ButtonProps, "type"> & {
  type?: "button" | "submit" | "reset";
  variant?: ButtonProps["type"];
};

export function UiButton({
  type = "button",
  variant,
  className,
  size,
  htmlType,
  ...props
}: UiButtonProps) {
  const primary = className?.split(/\s+/).includes("primary") ?? false;
  const mini = className?.split(/\s+/).includes("mini") ?? false;
  return (
    <AntButton
      {...props}
      htmlType={htmlType ?? type}
      type={variant ?? (primary ? "primary" : "default")}
      size={size ?? (mini ? "small" : "middle")}
      className={className}
    />
  );
}

/** 统一文本、密码和数字输入框；密码框等特殊类型继续使用 Ant Input 的标准能力。 */
export const UiInput = AntInput;

type SelectValue = string | number | undefined;
type SelectChangeEvent = ChangeEvent<HTMLSelectElement>;
type NativeOption = {
  value?: SelectValue;
  disabled?: boolean;
  children?: ReactNode;
};
type UiSelectProps = Omit<SelectProps, "children" | "options" | "onChange"> & {
  children?: ReactNode;
  onChange?: (event: SelectChangeEvent) => void;
};

/** 把原生 option 声明转换为 Ant Select 数据，并兼容现有 target.value 事件处理器。 */
export function UiSelect({ children, onChange, ...props }: UiSelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<NativeOption>(child)) return [];
    return [
      {
        value: child.props.value ?? String(child.props.children ?? ""),
        label: child.props.children,
        disabled: child.props.disabled,
      },
    ];
  });
  return (
    <AntSelect
      {...props}
      options={options}
      onChange={(value) =>
        onChange?.({ target: { value: String(value ?? "") } } as SelectChangeEvent)
      }
    />
  );
}

type UiSliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "value" | "defaultValue"
> & {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

/** 使用 Ant Slider 展示原生 range 的值，并保持现有输入事件回调兼容。 */
export function UiSlider({
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  ...props
}: UiSliderProps) {
  return (
    <AntSlider
      {...props}
      min={min === undefined ? 0 : Number(min)}
      max={max === undefined ? 100 : Number(max)}
      step={step === undefined ? 1 : Number(step)}
      value={value === undefined ? undefined : Number(value)}
      defaultValue={defaultValue === undefined ? undefined : Number(defaultValue)}
      onChange={(nextValue) =>
        onChange?.({ target: { value: String(nextValue) } } as ChangeEvent<HTMLInputElement>)
      }
    />
  );
}

type UiUploadProps = Omit<UploadProps, "beforeUpload" | "onChange" | "showUploadList"> & {
  children?: ReactNode;
  required?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

/** 用 Ant Upload 选择文件，但由业务表单继续负责文件校验和上传时机。 */
export function UiUpload({ children, onChange, required, ...props }: UiUploadProps) {
  return (
    <AntUpload
      {...props}
      aria-required={required || undefined}
      beforeUpload={() => false}
      showUploadList={false}
      onChange={({ fileList }) => {
        const files = fileList
          .map((file) => file.originFileObj)
          .filter(Boolean) as File[];
        onChange?.({ target: { files } } as unknown as ChangeEvent<HTMLInputElement>);
      }}
    >
      <span className="ui-upload-trigger">{children ?? "选择文件"}</span>
    </AntUpload>
  );
}

/** 业务卡片统一基于 Ant Card，并把 Body 内边距交给既有版式类控制。 */
export const UiCard = AntCard;

/** 简单的重复数据项优先使用 Ant List，复杂编辑区继续由业务组件排版。 */
export const UiList = AntList;
